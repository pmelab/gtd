import * as http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import * as https from "node:https"
import { isIP } from "node:net"
import { Readable } from "node:stream"
import { Context, Effect, FileSystem, Layer } from "effect"
import { pickBindHost } from "./Bind.js"
import { guard, type Exposure } from "./Guard.js"
import { UiError, UiHost, UiShell, UiUsageError, type UiHandler } from "./Ports.js"
import { parseServeStatus, publishServe, type ServeMapping, unpublishServe } from "./Serve.js"
import {
  nodeOwnerCache,
  probeNodeOwner,
  probeTailscaleStatus,
  type TailscaleStatus,
  whois,
} from "./Tailscale.js"
import { generateSelfSignedCert, loadCertPair, obtainTailscaleCert, type CertPair } from "./Tls.js"

export interface UiConfig {
  readonly port?: number | undefined
  readonly host?: string | undefined
  readonly cert?: string | undefined
  readonly key?: string | undefined
  readonly users?: readonly string[] | undefined
}

/** Where the server prints its URL; `flush` hands it to stdout before the server blocks. */
export interface UiOut {
  readonly write: (chunk: string) => void
  readonly flush: () => void
}

/** How a server is reached: the flags of `gtd workspace`. */
export interface ExposeOptions {
  readonly host?: string
  readonly port?: number
  readonly selfSigned: boolean
  readonly http?: boolean
}

interface BoundServer {
  readonly port: number
  readonly close: () => void
}

/**
 * `--host`, then `ui.host`, then a Tailscale interface scan, refusing only
 * when all three are absent. The tailnet IS this server's whole
 * authentication boundary, so an explicit host is the user's own deliberate
 * consent and is honoured exactly as given, `0.0.0.0` included.
 */
export const resolveBindHost = (
  host: string | undefined,
  config: UiConfig | undefined,
  pickHost: () => string | undefined,
): Effect.Effect<string, UiError> => {
  const resolved = host ?? config?.host ?? pickHost()
  return resolved === undefined
    ? Effect.fail(
        new UiError("no Tailscale interface found to bind to, and no --host given", [
          "join a tailnet, so a CGNAT (100.64.0.0/10) address is available",
          "or pass --host <address> to bind explicitly",
        ]),
      )
    : Effect.succeed(resolved)
}

/**
 * `--self-signed`, then a configured pair, then a real `tailscale cert`, then
 * refusal. Having none of the three REFUSES rather than silently defaulting to
 * self-signed, which would mean an unexpected `openssl` on every plain
 * the server. Tailscale is preferred because only its cert can match a tailnet
 * hostname; a self-signed cert for a CGNAT IP warns on every load.
 */
export const resolveCertPair = (
  options: ExposeOptions,
  config: UiConfig | undefined,
  bindHost: string,
  displayHost: string,
  tailscaleStatus: TailscaleStatus | undefined,
): Effect.Effect<CertPair, UiError, UiShell | UiHost | FileSystem.FileSystem> => {
  // The SAN must match whatever the browser actually dials: `displayHost`
  // (the tailnet hostname when the probe answered, otherwise identical to
  // `bindHost`) goes in as `DNS:`, and `bindHost` goes in as `IP:` only when
  // it's a literal — openssl's `-addext subjectAltName=IP:...` rejects a
  // non-literal value outright (confirmed: a hostname `--host` like
  // "localhost" fails with a raw "Error Loading command line extensions"
  // dump naming neither the flag nor the cause). Without this split, a
  // probe-detected hostname URL over an IP bind got a SAN of
  // `IP:<bind-ip>,DNS:<bind-ip>` while the browser dialed the hostname — a
  // name mismatch on every load, strictly worse than no detection at all.
  if (options.selfSigned) {
    return generateSelfSignedCert({
      host: displayHost,
      ...(isIP(bindHost) !== 0 ? { ip: bindHost } : {}),
    })
  }
  if (config?.cert !== undefined && config.key !== undefined) {
    return loadCertPair(config.cert, config.key)
  }
  if (config?.cert !== undefined || config?.key !== undefined) {
    const missing = config.cert === undefined ? "ui.cert" : "ui.key"
    return Effect.fail(
      new UiError(`${missing} is not configured — both cert and key are required`, [
        `ui.${config.cert === undefined ? "key" : "cert"} is configured, but ${missing} is not`,
        "pass --self-signed for a throwaway certificate instead",
      ]),
    )
  }
  const certDomain = tailscaleStatus?.certDomains[0]
  if (certDomain !== undefined) {
    // Chosen because CertDomains said it was available: a rate limit, an ACL
    // change, or HTTPS switched off between the two calls is a broken
    // tailnet, not "no certificate is configured" — so a non-zero exit here
    // fails outright, no fallback to the refusal, no fallback to
    // self-signed. `--self-signed` remains the escape.
    return obtainTailscaleCert(certDomain)
  }
  return Effect.fail(
    new UiError("HTTPS is mandatory and no certificate is configured", [
      "pass --self-signed for a throwaway certificate",
      "or configure ui.cert and ui.key",
      "or join a tailnet with HTTPS certs enabled for an automatic one",
    ]),
  )
}

/** `UiListener.listen`'s options: `tls` present means terminate TLS here (today's exact behavior); `tls` absent means a plain loopback listener for a `tailscale serve` reverse proxy to dial (Task 3). */
interface UiListenOptions {
  readonly tls?: CertPair
  readonly host: string
  readonly port: number
  readonly handler: UiHandler
}

/**
 * The subprocess/socket port for the actual listen — isolated behind a
 * service tag (mirroring `UiShell`) so tests can swap in a fake
 * without a real socket bind or a real certificate. One method, not two:
 * `tls` present picks `https.createServer`, absent picks a plain
 * `http.createServer` — the fake in `Server.test.ts` stays a single
 * function either way.
 */
export class UiListener extends Context.Service<
  UiListener,
  {
    readonly listen: (options: UiListenOptions) => Effect.Effect<BoundServer, UiError>
  }
>()("UiListener") {
  static readonly Live = Layer.succeed(UiListener, {
    listen: ({ tls, host, port, handler }) =>
      Effect.callback<BoundServer, UiError>((resume) => {
        const serve = viaNode(handler)
        const server =
          tls !== undefined
            ? https.createServer({ cert: tls.cert, key: tls.key }, serve)
            : http.createServer(serve)
        server.once("error", (err: NodeJS.ErrnoException) => {
          resume(
            Effect.fail(
              err.code === "EADDRINUSE"
                ? new UiError(`port ${port} is already in use`)
                : new UiError(`could not start the server: ${err.message}`),
            ),
          )
        })
        server.listen(port, host, () => {
          const address = server.address()
          const boundPort = typeof address === "object" && address !== null ? address.port : port
          resume(Effect.succeed({ port: boundPort, close: () => server.close() }))
        })
      }),
  })
}

/** `handler` as a Node request listener; `afterResponse` callbacks run once the response has flushed. */
const viaNode =
  (handler: UiHandler) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) {
      for (const one of [value ?? []].flat()) headers.append(name, one)
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD"
    let request: Request
    try {
      // A fixed origin: the client's Host header is not trusted to parse.
      request = new Request(new URL(req.url ?? "/", "http://localhost"), {
        method: req.method ?? "GET",
        headers,
        ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
      } as RequestInit)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, "")
    void handler(request, (callback) => res.once("finish", callback), peer).then(
      async (response) => {
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(Buffer.from(await response.arrayBuffer()))
      },
      () => {
        res.writeHead(500)
        res.end()
      },
    )
  }

/**
 * The tailscale serve front door's fixed candidate list, walked in order:
 * a default tailnet permits HTTPS serve only on 443, 8443 and 10000 unless
 * its policy file says otherwise — an arbitrary high port simply fails to
 * publish, so nothing outside this list is worth trying.
 */
const SERVE_PORT_CANDIDATES: readonly number[] = [8443, 10000, 443]

/** `0` means "auto-pick" for both `--port`/`ui.port` — identical to giving no port at all, and kept out of `publishServe --https=0`, which cannot publish. */
const normalizePort = (port: number | undefined): number | undefined =>
  port === 0 ? undefined : port

/**
 * Bundles bind/display host resolution with certificate resolution — pulled
 * out of `runUiCommand`'s own generator so that function's own cyclomatic/
 * cognitive complexity stays flat as this package adds the probe/branch
 * logic, rather than growing inline. An explicit `--host`/`ui.host` is the
 * user's own deliberate consent (`resolveBindHost`'s own doc comment):
 * detection never overrides it, so the probe only runs when neither was
 * given, and `displayHost` falls back to `bindHost` whenever it doesn't.
 */
const resolveHostsAndCert = (
  options: ExposeOptions,
  config: UiConfig | undefined,
): Effect.Effect<
  { readonly bindHost: string; readonly displayHost: string; readonly certPair: CertPair },
  UiError,
  UiShell | UiHost | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const host = yield* UiHost
    const bindHost = yield* resolveBindHost(options.host, config, () =>
      pickBindHost(host.networkInterfaces()),
    )
    const explicitHost = options.host ?? config?.host
    const tailscaleStatus = explicitHost !== undefined ? undefined : yield* probeTailscaleStatus()
    const displayHost = tailscaleStatus?.hostname ?? bindHost
    const certPair = yield* resolveCertPair(options, config, bindHost, displayHost, tailscaleStatus)
    return { bindHost, displayHost, certPair }
  })

/**
 * `ok: false` (the probe failed to run) is distinct from `ok: true, mapping:
 * undefined` (it ran and found nothing). Collapsing the two let the orphan
 * check publish over a mapping it simply could not see.
 */
const probeLiveServeMapping = (
  servePort: number,
): Effect.Effect<
  { readonly ok: true; readonly mapping: ServeMapping | undefined } | { readonly ok: false },
  never,
  UiShell
> =>
  Effect.gen(function* () {
    const runner = yield* UiShell
    const outcome = yield* runner
      .bash("tailscale serve status --json")
      .pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (outcome === undefined || outcome.status !== 0) return { ok: false }
    // `outcome.output` is stdout+stderr MERGED (`UiShell.ts`'s own
    // doc comment) — a version-mismatch warning or any other exit-0 stderr
    // chatter appended there would make otherwise-valid JSON unparseable,
    // and an unparseable probe must never read as "nothing published here"
    // (this function's own `ok: true, mapping: undefined` case). `stdout`
    // alone is the actual JSON `tailscale serve status --json` prints.
    return { ok: true, mapping: parseServeStatus(outcome.stdout ?? outcome.output, servePort) }
  })

/**
 * Ownership, checked before publishing. A foreign live mapping is left
 * untouched, as is a probe that FAILED — an unreadable status proves nothing
 * about whether the port is free. A record naming a dead pid is stale and
 * cleared; one naming another LIVE server is left alone, since two instances
 * racing a port is what ownership exists to prevent.
 *
 * `"occupied"` and `"unknowable"` are both "don't publish", but the candidate
 * walk treats them differently: `"occupied"` is per-port and walkable, while
 * `"unknowable"` says nothing about any port and would only re-run the same
 * failing subprocess, so it aborts the walk.
 */
const clearOrphanForPublish = (
  servePort: number,
): Effect.Effect<"clear" | "occupied" | "unknowable", never, UiShell | UiHost> =>
  Effect.gen(function* () {
    const host = yield* UiHost
    const record = host.serveRecords.read(servePort)
    if (record === undefined) {
      const probe = yield* probeLiveServeMapping(servePort)
      if (!probe.ok) return "unknowable"
      return probe.mapping === undefined ? "clear" : "occupied"
    }
    if (host.isPidAlive(record.pid) && record.pid !== process.pid) return "occupied"
    yield* unpublishServe(servePort).pipe(Effect.catch(() => Effect.succeed(undefined)))
    host.serveRecords.delete(servePort)
    return "clear"
  })

/**
 * One candidate attempt's result. `retry: true` when the failure is plausibly
 * per-port (a foreign mapping, a publish that exited non-zero); `retry: false`
 * when serve isn't viable at all this run. Never a failed Effect.
 */
type ServeAttempt =
  | {
      readonly ok: true
      readonly bound: BoundServer
      readonly url: string
      readonly servePort: number
    }
  | { readonly ok: false; readonly retry: boolean; readonly reason: string }

/**
 * The serve-first path: probe, orphan-check, bind an EPHEMERAL loopback
 * listener (`tailscaled` terminates TLS and proxies in, so nothing outside the
 * machine dials it), then publish. Every failure closes whatever it bound and
 * returns one human-readable reason. The `never` error channel makes "a
 * direct-bind fallback is always available" a type-checked invariant.
 */
const attemptServe = (
  servePort: number,
  worktree: string,
  uiListener: Context.Service.Shape<typeof UiListener>,
  handlerFor: (exposure: Exposure) => UiHandler,
): Effect.Effect<ServeAttempt, never, UiShell | UiHost> =>
  Effect.gen(function* () {
    const tailscaleStatus = yield* probeTailscaleStatus()
    if (tailscaleStatus === undefined) {
      return { ok: false, retry: false, reason: "no Tailscale backend detected" } as const
    }

    const orphanStatus = yield* clearOrphanForPublish(servePort)
    if (orphanStatus === "occupied") {
      return {
        ok: false,
        retry: true,
        reason: `port ${servePort} already carries a tailscale serve mapping this instance does not own`,
      } as const
    }
    if (orphanStatus === "unknowable") {
      return {
        ok: false,
        retry: false,
        reason: `could not confirm port ${servePort} is free — tailscale serve status --json failed`,
      } as const
    }

    const boundAttempt = yield* uiListener
      .listen({ host: "127.0.0.1", port: 0, handler: handlerFor("serve") })
      .pipe(
        Effect.map((bound) => ({ ok: true as const, bound })),
        Effect.catch((e) => Effect.succeed({ ok: false as const, reason: e.message })),
      )
    if (!boundAttempt.ok) {
      return {
        ok: false,
        retry: false,
        reason: `could not bind the loopback listener: ${boundAttempt.reason}`,
      } as const
    }
    const bound = boundAttempt.bound

    const publishResult = yield* publishServe({ servePort, targetPort: bound.port }).pipe(
      Effect.catch((e) => Effect.succeed({ ok: false as const, reason: e.message, output: "" })),
    )
    if (!publishResult.ok) {
      yield* Effect.sync(() => bound.close())
      return {
        ok: false,
        retry: true,
        reason: `tailscale serve failed: ${publishResult.reason}`,
      } as const
    }

    ;(yield* UiHost).serveRecords.write(servePort, {
      pid: process.pid,
      servePort,
      targetPort: bound.port,
      target: `http://127.0.0.1:${bound.port}`,
      worktree,
    })

    const url =
      servePort === 443
        ? `https://${tailscaleStatus.hostname}/`
        : `https://${tailscaleStatus.hostname}:${servePort}/`
    return { ok: true, bound, url, servePort } as const
  })

/**
 * Removes only a mapping THIS instance published. A diverged target means
 * another process took the port over — the record is deleted without touching
 * that mapping. A probe that FAILED proves nothing, so the record is left
 * exactly as it is: this instance's dead pid then lets the NEXT server's
 * orphan check clear it, rather than stranding a live mapping behind a deleted
 * record. Never fails — `Effect.ensuring` requires it.
 */
const teardownServe = (servePort: number): Effect.Effect<void, never, UiShell | UiHost> =>
  Effect.gen(function* () {
    const host = yield* UiHost
    const record = host.serveRecords.read(servePort)
    if (record === undefined) return
    const probe = yield* probeLiveServeMapping(servePort)
    if (!probe.ok) return
    if (probe.mapping !== undefined && probe.mapping.targetUrl === record.target) {
      yield* unpublishServe(servePort).pipe(Effect.catch(() => Effect.succeed(undefined)))
    }
    host.serveRecords.delete(servePort)
  })

const isLoopbackHost = (host: string): boolean =>
  host === "localhost" ||
  (isIP(host) === 6 && new URL(`http://[${host}]`).hostname === "[::1]") ||
  (isIP(host) === 4 && host.startsWith("127."))

const httpBind = (
  options: ExposeOptions,
  explicitHost: string | undefined,
  explicitPort: number | undefined,
  uiListener: Context.Service.Shape<typeof UiListener>,
  handlerFor: (exposure: Exposure) => UiHandler,
): Effect.Effect<{ readonly bound: BoundServer; readonly url: string }, UiError> =>
  Effect.gen(function* () {
    const bindHost = explicitHost ?? "127.0.0.1"
    if (!isLoopbackHost(bindHost)) {
      return yield* Effect.fail(
        new UiUsageError(`--http needs a loopback bind host, got ${bindHost}`, [
          "use 127.0.0.0/8, ::1 or localhost, so only a local proxy can reach it",
        ]),
      )
    }
    const bound = yield* uiListener.listen({
      host: bindHost,
      port: explicitPort ?? 0,
      handler: handlerFor("proxy"),
    })
    return {
      bound,
      url: `http://${isIP(bindHost) === 6 ? `[${bindHost}]` : bindHost}:${bound.port}/`,
    }
  })

/**
 * An explicit `--host`/`ui.host` or `--self-signed` skips serve entirely;
 * otherwise the candidate walk runs first, printing the LAST candidate's
 * failure reason above the URL before falling back. Never a refusal either way.
 */
const resolveListener = (args: {
  readonly options: ExposeOptions
  readonly config: UiConfig | undefined
  readonly explicitPort: number | undefined
  readonly explicitHost: string | undefined
  readonly worktree: string
  readonly uiListener: Context.Service.Shape<typeof UiListener>
  readonly handlerFor: (exposure: Exposure) => UiHandler
  readonly out: UiOut
}): Effect.Effect<
  {
    readonly bound: BoundServer
    readonly url: string
    readonly teardown: Effect.Effect<void, never, UiShell | UiHost>
  },
  UiError,
  UiShell | UiHost | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const { options, config, explicitPort, explicitHost, worktree, uiListener, handlerFor, out } =
      args

    const directBind = (): Effect.Effect<
      { readonly bound: BoundServer; readonly url: string },
      UiError,
      UiShell | UiHost | FileSystem.FileSystem
    > =>
      Effect.gen(function* () {
        const { bindHost, displayHost, certPair } = yield* resolveHostsAndCert(options, config)
        const bound = yield* uiListener.listen({
          tls: certPair,
          host: bindHost,
          port: explicitPort ?? 0,
          handler: handlerFor("direct"),
        })
        return { bound, url: `https://${displayHost}:${bound.port}/` }
      })

    if (options.http === true) {
      const bound = yield* httpBind(options, explicitHost, explicitPort, uiListener, handlerFor)
      return { bound: bound.bound, url: bound.url, teardown: Effect.void }
    }

    if (explicitHost !== undefined || options.selfSigned) {
      const { bound, url } = yield* directBind()
      // The direct bind never touches `tailscale serve` — its teardown is a no-op.
      return { bound, url, teardown: Effect.void }
    }

    const candidates = explicitPort !== undefined ? [explicitPort] : SERVE_PORT_CANDIDATES
    const tried: Array<{ readonly port: number; readonly reason: string }> = []
    for (const candidate of candidates) {
      const attempt = yield* attemptServe(candidate, worktree, uiListener, handlerFor)
      if (attempt.ok) {
        return {
          bound: attempt.bound,
          url: attempt.url,
          teardown: teardownServe(attempt.servePort),
        }
      }
      tried.push({ port: candidate, reason: attempt.reason })
      if (!attempt.retry) break
    }
    // Never a refusal — one line naming why, above the printed URL, then
    // today's direct bind exactly as if serve had never been attempted. Only
    // the LAST candidate's reason is printed; every port actually tried is
    // named ahead of it when the walk went past one.
    const last = tried[tried.length - 1]!
    const reason =
      tried.length > 1
        ? `tried ${tried.map((t) => t.port).join(", ")} — ${last.reason}`
        : last.reason
    out.write(`not using tailscale serve — ${reason}\n`)
    const { bound, url } = yield* directBind()
    return { bound, url, teardown: Effect.void }
  })

/** A server listening, and how to stop it and undo its `tailscale serve` mapping. */
export interface Exposed {
  readonly url: string
  readonly close: Effect.Effect<void, never, UiShell | UiHost>
}

/**
 * Serves `handler` the way `gtd workspace` does: through `tailscale serve`, on the
 * tailnet interface, or behind `--http`, with every request held to the
 * tailnet identity and same-origin checks (ADR 0014). `label` names the
 * server in its serve ownership record.
 */
export const exposeHandler = (args: {
  readonly options: ExposeOptions
  readonly config: UiConfig | undefined
  readonly handler: UiHandler
  readonly label: string
  readonly out: UiOut
}): Effect.Effect<Exposed, UiError, UiShell | UiHost | FileSystem.FileSystem | UiListener> =>
  Effect.gen(function* () {
    const { options, config, handler, label, out } = args
    const runner = yield* UiShell
    const uiListener = yield* UiListener

    const tailnet = <A>(effect: Effect.Effect<A, never, UiShell>): Promise<A> =>
      Effect.runPromise(effect.pipe(Effect.provideService(UiShell, runner)))
    const nodeOwner = nodeOwnerCache(() => tailnet(probeNodeOwner()), Date.now)
    const users = async (): Promise<readonly string[] | undefined> => {
      if (config?.users !== undefined) return config.users
      const owner = await nodeOwner()
      return owner === undefined ? undefined : [owner]
    }
    const logins = new Map<string, string>()
    const peerLogin = async (address: string): Promise<string | undefined> => {
      const known = logins.get(address)
      if (known !== undefined) return known
      const login = await tailnet(whois(address))
      if (login !== undefined) logins.set(address, login)
      return login
    }

    const { bound, url, teardown } = yield* resolveListener({
      options,
      config,
      explicitPort: normalizePort(options.port ?? config?.port),
      explicitHost: options.host ?? config?.host,
      worktree: label,
      uiListener,
      handlerFor: (exposure) => guard({ exposure, users, whois: peerLogin }, handler),
      out,
    })
    return { url, close: Effect.sync(() => bound.close()).pipe(Effect.andThen(teardown)) }
  })
