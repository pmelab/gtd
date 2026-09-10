import { existsSync, readFileSync } from "node:fs"
import * as http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import * as https from "node:https"
import { isIP } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHTTPHandler } from "@trpc/server/adapters/standalone"
import { FileSystem } from "@effect/platform"
import { Context, Deferred, Effect, Layer, Runtime } from "effect"
import type { ArtifactOut } from "../Cli.js"
import { GtdError, GtdUsageError } from "../Commentary.js"
import { CommandRunner } from "../CommandRunner.js"
import type { UiConfig } from "../ConfigSchema.js"
import { Cwd } from "../Cwd.js"
import { steeringFormatFor } from "../SteeringFormats.js"
import generatedClientHtml from "../web/generated.html"
import {
  liveHeadSha,
  liveRunInWorktree,
  readLocalGtdVersionAt,
  readStep,
  type Step,
  type StepRead,
} from "./Beat.js"
import { pickBindHostFromSystem } from "./BindSystem.js"
import { resolveDiff, type DiffDeps } from "./Diff.js"
import { readSteeringFile, type ReadSteeringFileDeps } from "./ReadSteeringFile.js"
import { appRouter, type RouterContext } from "./Router.js"
import { inlineScript, inlineStyles } from "./scriptTag.mjs"
import {
  deleteServeRecord,
  parseServeStatus,
  publishServe,
  readServeRecord,
  type ServeMapping,
  unpublishServe,
  writeServeRecord,
} from "./Serve.js"
import { probeTailscaleStatus, type TailscaleStatus } from "./Tailscale.js"
import { generateSelfSignedCert, loadCertPair, obtainTailscaleCert, type CertPair } from "./Tls.js"
import {
  liveActorAt,
  liveReadFile,
  liveWriteFile,
  writeNote,
  writeValue,
  type WriteDeps,
} from "./Write.js"

/** `/trpc` prefix: everything under it is the tRPC API surface; everything else keeps serving the client HTML exactly as before. */
const TRPC_PATH_PREFIX = "/trpc"

/** The fields `Cli.ts`'s parsed `{ kind: "ui" }` command carries — this module never reads `Command` itself to stay independent of its parsing. */
export interface UiCommandOptions {
  readonly host?: string
  readonly port?: number
  readonly selfSigned: boolean
  readonly dev: boolean
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void

interface BoundServer {
  readonly port: number
  readonly close: () => void
}

/**
 * Determines the bind host: an explicit `--host`, then a configured
 * `ui.host`, then a scan for a Tailscale interface — refusing only when all
 * three are absent. The tailnet IS this server's whole authentication
 * boundary (there is no other), so an explicit `--host`/`ui.host` is the
 * user's own deliberate consent and stays honoured exactly as given,
 * `--host 0.0.0.0` included — this never second-guesses that choice, only
 * supplies a default when none was made. `pickHost` defaults to the real
 * system scan but is a parameter so tests can simulate "no tailnet" without
 * touching `os.networkInterfaces()`.
 */
export const resolveBindHost = (
  host: string | undefined,
  config: UiConfig | undefined,
  pickHost: () => string | undefined = pickBindHostFromSystem,
): Effect.Effect<string, GtdError> => {
  const resolved = host ?? config?.host ?? pickHost()
  return resolved === undefined
    ? Effect.fail(
        new GtdError("gtd ui: no Tailscale interface found to bind to, and no --host given", [
          "join a tailnet, so a CGNAT (100.64.0.0/10) address is available",
          "or pass --host <address> to bind explicitly",
        ]),
      )
    : Effect.succeed(resolved)
}

/**
 * Determines the certificate/key pair, four branches in order: `--self-
 * signed` always wins (an explicit ask, honored even if `ui.cert`/`ui.key`
 * are also configured), then a configured pair, then a real `tailscale cert`
 * for `tailscaleStatus`'s hostname when its `certDomains` is non-empty (the
 * probe for whether the tailnet has HTTPS certs enabled at all), then
 * refusal. Neither a configured pair nor an available Tailscale cert is a
 * refusal, not a silent default to self-signed — that would mean an
 * unexpected `openssl` invocation on every plain `gtd ui`. The Tailscale
 * branch is exactly why this shells out to `tailscale`, not `openssl`, when
 * it's available: only a Tailscale-issued cert can ever match a tailnet
 * hostname URL, and a self-signed cert for a CGNAT IP is a browser warning
 * on every load.
 */
export const resolveCertPair = (
  options: UiCommandOptions,
  config: UiConfig | undefined,
  bindHost: string,
  displayHost: string,
  tailscaleStatus: TailscaleStatus | undefined,
): Effect.Effect<CertPair, GtdError, CommandRunner | FileSystem.FileSystem> => {
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
      new GtdError(`gtd ui: ${missing} is not configured — both cert and key are required`, [
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
    new GtdError("gtd ui: HTTPS is mandatory and no certificate is configured", [
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
  readonly handler: RequestHandler
}

/**
 * The subprocess/socket port for the actual listen — isolated behind a
 * service tag (mirroring `CommandRunner`) so tests can swap in a fake
 * without a real socket bind or a real certificate. One method, not two:
 * `tls` present picks `https.createServer`, absent picks a plain
 * `http.createServer` — the fake in `Server.test.ts` stays a single
 * function either way.
 */
export class UiListener extends Context.Tag("UiListener")<
  UiListener,
  {
    readonly listen: (options: UiListenOptions) => Effect.Effect<BoundServer, GtdError>
  }
>() {
  static readonly Live = Layer.succeed(UiListener, {
    listen: ({ tls, host, port, handler }) =>
      Effect.async<BoundServer, GtdError>((resume) => {
        const server =
          tls !== undefined
            ? https.createServer({ cert: tls.cert, key: tls.key }, handler)
            : http.createServer(handler)
        server.once("error", (err: NodeJS.ErrnoException) => {
          resume(
            Effect.fail(
              err.code === "EADDRINUSE"
                ? new GtdError(`gtd ui: port ${port} is already in use`)
                : new GtdError(`gtd ui: could not start the server: ${err.message}`),
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

const DEFAULT_PORT = 8443

/**
 * `--dev` needs the gtd SOURCE checkout (its `src/web/`, its `tsdown.config.ts`,
 * its devDependencies) to rebuild against — never the invoking directory,
 * which `ui` deliberately runs outside of (see `needsOf("ui")`). Walks
 * up from this module's own file — `src/ui/Server.ts` in a source checkout,
 * or the single bundled `dist/gtd.bundle.mjs` in an installed package, both of
 * which sit a fixed few directories under the package root — until it finds
 * the `package.json` that names this package, so the search works from either
 * shape without hardcoding a directory depth.
 */
const findPackageRoot = (): Effect.Effect<string, GtdError> =>
  Effect.try({
    try: () => {
      let dir = dirname(fileURLToPath(import.meta.url))
      for (let i = 0; i < 8; i++) {
        const pkgPath = join(dir, "package.json")
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string }
          if (pkg.name === "@pmelab/gtd") return dir
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
      throw new Error("no @pmelab/gtd package.json found above this module")
    },
    catch: () =>
      new GtdError("gtd ui --dev: could not locate the gtd source checkout to rebuild the client", [
        "--dev is for developing gtd's own web client: run it from a",
        "checked-out gtd repository with devDependencies installed",
      ]),
  })

/** `--dev`: the raw template, read once at startup — editing it needs a server restart, same as the rebuilt script it's inlined into (T5: the server lives for exactly one step, so a mid-step rebuild would have nothing left to reflect). */
const readDevTemplate = (
  fs: FileSystem.FileSystem,
  root: string,
): Effect.Effect<string, GtdError> =>
  fs
    .readFileString(join(root, "src/web/index.html"))
    .pipe(
      Effect.mapError(
        (e) => new GtdError(`gtd ui --dev: could not read src/web/index.html: ${e.message}`),
      ),
    )

/**
 * `--dev`: rebuilds the browser bundle via the same tsdown config `npm run
 * build` uses (`--filter web` selects only that config's `name`), then reads
 * its freshly-written output — the simplest way to reflect an edited client
 * source file with no manual `npm run build`. Runs with `root` (the gtd
 * package's OWN directory, never the invoking cwd) as its working directory —
 * a plain `npx tsdown` in the invoking directory would have no tsdown.config.ts
 * to select against, since `ui` deliberately runs outside any repo. Called
 * exactly ONCE, ahead of `uiListener.listen` (T5) — an HTTP request can no
 * longer trigger this build: the server lives for exactly one step, so a
 * mid-step rebuild would have nothing left to reflect, and a build per
 * unauthenticated request was subprocess amplification for free.
 */
const rebuildDevClientScript = (
  runner: Context.Tag.Service<typeof CommandRunner>,
  fs: FileSystem.FileSystem,
  root: string,
): Effect.Effect<string, GtdError> =>
  Effect.gen(function* () {
    const outcome = yield* runner
      .bash(`cd ${JSON.stringify(root)} && npx tsdown --filter web`)
      .pipe(
        Effect.mapError(
          (e) => new GtdError(`gtd ui --dev: could not rebuild the client: ${e.message}`),
        ),
      )
    if (outcome.status !== 0) {
      return yield* Effect.fail(
        new GtdError(
          "gtd ui --dev: rebuilding the client failed",
          outcome.output.trim().split("\n").filter(Boolean),
        ),
      )
    }
    return yield* fs
      .readFileString(join(root, "dist/web/main.js"))
      .pipe(
        Effect.mapError(
          (e) => new GtdError(`gtd ui --dev: could not read the rebuilt client: ${e.message}`),
        ),
      )
  })

/**
 * `--dev`'s CSS sibling of `rebuildDevClientScript` — the packaged build's
 * own `npm run build` runs the Tailwind CLI as a step separate from tsdown
 * (see package.json), so `--dev` shells out to that same CLI rather than
 * teaching tsdown about CSS at all.
 */
const rebuildDevClientCss = (
  runner: Context.Tag.Service<typeof CommandRunner>,
  fs: FileSystem.FileSystem,
  root: string,
): Effect.Effect<string, GtdError> =>
  Effect.gen(function* () {
    const outcome = yield* runner
      .bash(
        `cd ${JSON.stringify(root)} && npx @tailwindcss/cli -i src/web/styles.css -o dist/web/main.css`,
      )
      .pipe(
        Effect.mapError(
          (e) => new GtdError(`gtd ui --dev: could not rebuild the stylesheet: ${e.message}`),
        ),
      )
    if (outcome.status !== 0) {
      return yield* Effect.fail(
        new GtdError(
          "gtd ui --dev: rebuilding the stylesheet failed",
          outcome.output.trim().split("\n").filter(Boolean),
        ),
      )
    }
    return yield* fs
      .readFileString(join(root, "dist/web/main.css"))
      .pipe(
        Effect.mapError(
          (e) => new GtdError(`gtd ui --dev: could not read the rebuilt stylesheet: ${e.message}`),
        ),
      )
  })

/** The one piece of content this server ever serves: the client HTML, with its JS AND CSS inlined — a build-time constant in production, resolved ONCE at startup under `--dev` too (T5) and held for the process's whole lifetime, never re-read or rebuilt per request. */
export const resolveClientHtml = (
  dev: boolean,
  runner: Context.Tag.Service<typeof CommandRunner>,
  fs: FileSystem.FileSystem,
): Effect.Effect<string, GtdError> =>
  dev
    ? findPackageRoot().pipe(
        Effect.flatMap((root) =>
          Effect.all([
            readDevTemplate(fs, root),
            rebuildDevClientScript(runner, fs, root),
            rebuildDevClientCss(runner, fs, root),
          ]),
        ),
        Effect.map(([template, script, css]) => inlineStyles(inlineScript(template, script), css)),
      )
    : Effect.succeed(generatedClientHtml)

export type UiRequirements = CommandRunner | FileSystem.FileSystem | UiListener | Cwd

/** Every dependency `readStep` needs, wired to the real subprocess/filesystem reads — `gtd ui` never injects a fake here, unlike its own test suite. */
const liveBeatDeps = {
  run: liveRunInWorktree,
  readLocalGtdVersion: readLocalGtdVersionAt,
  headSha: liveHeadSha,
}

/**
 * `true` only for the one rest the phone client can actually render: a
 * non-idle rest whose ACTOR is human, carrying a `file` and a `mode` that
 * resolves to a registered steering format. `kind` is never read — a
 * `message` rest whose beat reports a human actor with a registered mode is
 * just as renderable as a `prompt` rest with the same shape, and content
 * kind shifts under the human's own editing (a `message` rest turns
 * `capture` the moment the tree is dirtied), so it's the wrong axis
 * regardless of which kinds would be listed. This is the SAME axis
 * `Write.ts#verifyForWrite` already gates writes on (`actorAt !== "human"` →
 * `not-resting`), so startup and write agree.
 */
const isRenderable = (
  step: Step,
): step is Step & { readonly file: string; readonly mode: string } =>
  !step.idle &&
  step.actor === "human" &&
  step.file !== undefined &&
  step.mode !== undefined &&
  steeringFormatFor(step.mode) !== undefined

/**
 * The refusal named for whatever the served worktree actually rests at, in
 * order so the narrower cause always wins: unreadable, idle (checked BEFORE
 * the actor test — an idle worktree reports `actor: human` too, so an
 * actor-only test would bind a port on a finished worktree), a non-human
 * actor, then a human rest whose steering file isn't usable.
 */
const refusalFor = (step: StepRead): GtdUsageError => {
  if (step.status !== "ok") {
    return new GtdUsageError(
      `gtd ui: refuses to start — this worktree can't be read: ${step.status === "broken" ? step.detail : step.label}`,
    )
  }
  if (step.idle) {
    return new GtdUsageError(
      `gtd ui: refuses to start — "${step.label}" is idle, so there is nothing to hand back`,
    )
  }
  if (step.actor !== "human") {
    return new GtdUsageError(
      `gtd ui: refuses to start — "${step.label}" rests with the ${step.actor}, which has no phone screen`,
    )
  }
  const hint =
    step.mode === undefined
      ? "gtd next --json reported no steering mode for this rest"
      : steeringFormatFor(step.mode) === undefined
        ? `"${step.mode}" is not a registered steering mode`
        : "gtd next --json reported no steering file for this rest"
  return new GtdUsageError(
    `gtd ui: refuses to start — "${step.label}" rests with you, but its steering file has no phone screen`,
    [hint],
  )
}

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
  options: UiCommandOptions,
  config: UiConfig | undefined,
): Effect.Effect<
  { readonly bindHost: string; readonly displayHost: string; readonly certPair: CertPair },
  GtdError,
  CommandRunner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const bindHost = yield* resolveBindHost(options.host, config)
    const explicitHost = options.host ?? config?.host
    const tailscaleStatus = explicitHost !== undefined ? undefined : yield* probeTailscaleStatus()
    const displayHost = tailscaleStatus?.hostname ?? bindHost
    const certPair = yield* resolveCertPair(options, config, bindHost, displayHost, tailscaleStatus)
    return { bindHost, displayHost, certPair }
  })

/** `process.kill(pid, 0)` sends no signal, just probes liveness — throws (ESRCH/EPERM) for a dead or unreachable pid. */
const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Re-reads `tailscale serve status --json` fresh — used both by the orphan
 * check (Task 4, before publishing) and by teardown (after). `ok: false`
 * (a spawn failure or a non-zero exit) is distinct from `ok: true, mapping:
 * undefined` (the probe RAN and found nothing on `servePort`): the
 * `undefined`-is-never-a-failure rule `Serve.ts#parseServeStatus` sets is
 * about the JSON PARSE, not about a probe that never produced JSON to parse
 * at all — collapsing the two let the orphan check publish over a mapping it
 * simply couldn't see (a foreign holder, an operator-permission error, a
 * `tailscaled` restart mid-probe).
 */
const probeLiveServeMapping = (
  servePort: number,
): Effect.Effect<
  { readonly ok: true; readonly mapping: ServeMapping | undefined } | { readonly ok: false },
  never,
  CommandRunner
> =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    const outcome = yield* runner
      .bash("tailscale serve status --json")
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    if (outcome === undefined || outcome.status !== 0) return { ok: false }
    return { ok: true, mapping: parseServeStatus(outcome.output, servePort) }
  })

/**
 * Task 4's ownership guarantees, run before ever publishing: a foreign live
 * mapping with no record of ours is left untouched (the caller falls back to
 * a direct bind rather than overwriting it) — and so is a probe that FAILED
 * to answer at all, since an unreadable status proves nothing about whether
 * the port is free; a record naming a dead pid (or, degenerate but cheap to
 * check, our own) is stale — cleared via `unpublishServe` before a fresh
 * publish; a record naming another LIVE gtd ui is left alone too, since two
 * instances racing the same port is exactly the case ownership exists to
 * prevent. Returns `true` when it's safe to proceed to `publishServe`,
 * `false` when the caller should fall back without ever calling it.
 */
const clearOrphanForPublish = (servePort: number): Effect.Effect<boolean, never, CommandRunner> =>
  Effect.gen(function* () {
    const record = readServeRecord(servePort)
    if (record === undefined) {
      const probe = yield* probeLiveServeMapping(servePort)
      if (!probe.ok) return false
      return probe.mapping === undefined
    }
    if (isPidAlive(record.pid) && record.pid !== process.pid) return false
    yield* unpublishServe(servePort).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    deleteServeRecord(servePort)
    return true
  })

/** What a serve attempt yields the caller: either a bound loopback listener plus the printable tailnet URL, or a one-line reason to fall back on — never a failed Effect (Task 3's own "never refuses" rule). */
type ServeAttempt =
  | { readonly ok: true; readonly bound: BoundServer; readonly url: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Task 3's serve-first path: probe for a tailnet hostname, run the Task 4
 * orphan check, bind an EPHEMERAL loopback listener (nothing outside the
 * machine dials it directly — `tailscaled` terminates TLS and proxies in),
 * then `publishServe` on `servePort`. Every failure — no tailnet, an
 * unclearable foreign mapping, the loopback bind itself refusing (EADDRINUSE,
 * EMFILE, a sandbox that denies it), a non-zero `tailscale serve` exit —
 * closes whatever it bound and returns `ok: false` with one human-readable
 * reason. The `never` error channel makes "it never fails the Effect, so
 * `runUiCommand` always has a direct-bind fallback available" a type-checked
 * invariant rather than a claim only the doc comment made.
 */
const attemptServe = (
  servePort: number,
  worktree: string,
  uiListener: Context.Tag.Service<typeof UiListener>,
  handler: RequestHandler,
): Effect.Effect<ServeAttempt, never, CommandRunner> =>
  Effect.gen(function* () {
    const tailscaleStatus = yield* probeTailscaleStatus()
    if (tailscaleStatus === undefined) {
      return { ok: false, reason: "no Tailscale backend detected" } as const
    }

    const clearedForPublish = yield* clearOrphanForPublish(servePort)
    if (!clearedForPublish) {
      return {
        ok: false,
        reason: `port ${servePort} already carries a tailscale serve mapping this instance does not own`,
      } as const
    }

    const boundAttempt = yield* uiListener.listen({ host: "127.0.0.1", port: 0, handler }).pipe(
      Effect.map((bound) => ({ ok: true as const, bound })),
      Effect.catchAll((e) => Effect.succeed({ ok: false as const, reason: e.message })),
    )
    if (!boundAttempt.ok) {
      return {
        ok: false,
        reason: `could not bind the loopback listener: ${boundAttempt.reason}`,
      } as const
    }
    const bound = boundAttempt.bound

    const publishResult = yield* publishServe({ servePort, targetPort: bound.port }).pipe(
      Effect.catchAll((e) => Effect.succeed({ ok: false as const, reason: e.message, output: "" })),
    )
    if (!publishResult.ok) {
      yield* Effect.sync(() => bound.close())
      return { ok: false, reason: `tailscale serve failed: ${publishResult.reason}` } as const
    }

    writeServeRecord(servePort, {
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
    return { ok: true, bound, url } as const
  })

/**
 * Task 4's teardown half of `attemptServe`: removes only a mapping THIS
 * instance published. No record at all (serve was never attempted, or the
 * direct-bind fallback ran instead) is a silent no-op. A record whose live
 * mapping still points at our own `target` is unpublished, then deleted; a
 * record whose target has since diverged means another process took the
 * port over already — deleted without touching that mapping. A probe that
 * FAILED to run (mirroring `clearOrphanForPublish`'s own publish-side rule)
 * proves nothing either way — the record is left exactly as it is, never
 * deleted, so this instance's own dead pid (once the process actually exits)
 * lets the NEXT `gtd ui`'s orphan check clear it properly instead of leaving
 * a live mapping permanently unreachable behind a deleted record. Never
 * fails: this runs inside `Effect.ensuring`, which requires it.
 */
const teardownServe = (servePort: number): Effect.Effect<void, never, CommandRunner> =>
  Effect.gen(function* () {
    const record = readServeRecord(servePort)
    if (record === undefined) return
    const probe = yield* probeLiveServeMapping(servePort)
    if (!probe.ok) return
    if (probe.mapping !== undefined && probe.mapping.targetUrl === record.target) {
      yield* unpublishServe(servePort).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    }
    deleteServeRecord(servePort)
  })

/**
 * Task 3's full control flow, factored out of `runUiCommand`'s own generator
 * so that function's own cyclomatic/cognitive complexity stays flat (mirrors
 * why `resolveHostsAndCert` was pulled out for Package 02): an explicit
 * `--host`/`ui.host` or `--self-signed` skips serve entirely (step 1);
 * otherwise `attemptServe` is tried first, its own failure reason printed
 * above the URL before falling back (step 3) — never a refusal either way.
 */
const resolveListener = (args: {
  readonly options: UiCommandOptions
  readonly config: UiConfig | undefined
  readonly port: number
  readonly explicitHost: string | undefined
  readonly worktree: string
  readonly uiListener: Context.Tag.Service<typeof UiListener>
  readonly handler: RequestHandler
  readonly out: ArtifactOut
}): Effect.Effect<
  {
    readonly bound: BoundServer
    readonly url: string
    readonly teardown: Effect.Effect<void, never, CommandRunner>
  },
  GtdError,
  CommandRunner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const { options, config, port, explicitHost, worktree, uiListener, handler, out } = args

    const directBind = (): Effect.Effect<
      { readonly bound: BoundServer; readonly url: string },
      GtdError,
      CommandRunner | FileSystem.FileSystem
    > =>
      Effect.gen(function* () {
        const { bindHost, displayHost, certPair } = yield* resolveHostsAndCert(options, config)
        const bound = yield* uiListener.listen({ tls: certPair, host: bindHost, port, handler })
        return { bound, url: `https://${displayHost}:${bound.port}/` }
      })

    if (explicitHost !== undefined || options.selfSigned) {
      const { bound, url } = yield* directBind()
      // The direct bind never touches `tailscale serve` — its teardown is a no-op.
      return { bound, url, teardown: Effect.void }
    }

    const attempt = yield* attemptServe(port, worktree, uiListener, handler)
    if (attempt.ok) {
      return { bound: attempt.bound, url: attempt.url, teardown: teardownServe(port) }
    }
    // Never a refusal — one line naming why, above the printed URL, then
    // today's direct bind exactly as if serve had never been attempted.
    out.write(`gtd ui: not using tailscale serve — ${attempt.reason}\n`)
    const { bound, url } = yield* directBind()
    return { bound, url, teardown: Effect.void }
  })

/**
 * `gtd ui`: binds an HTTPS server exposing the phone/web client for the ONE
 * worktree `Cwd` names — never a fleet, never a spawned loop. The server
 * lives for exactly one step: it starts, shows that step, takes the human's
 * input, and exits — either because the human handed the turn back (`done`
 * resolves `ctx.handOff()`'s deferred once the response has flushed) or
 * because the process was signalled (SIGINT/SIGTERM, handled by the runtime,
 * untouched here).
 */
export const runUiCommand = (
  options: UiCommandOptions,
  config: UiConfig | undefined,
  out: ArtifactOut,
): Effect.Effect<void, GtdError, UiRequirements> =>
  Effect.gen(function* () {
    const cwd = yield* Cwd

    // Read before resolving the bind host or the certificate, so a refusal
    // never invokes openssl (T1's own acceptance bullet).
    const step = yield* Effect.promise(() => readStep({ path: cwd.root }, liveBeatDeps))
    if (step.status === "broken" || !isRenderable(step)) {
      return yield* Effect.fail(refusalFor(step))
    }
    // Captured once, at startup — the served rest's own machine identity, so
    // `step` (below) can tell "still the same rest" from "the outer loop
    // moved on while we were up" without re-deriving anything from `label`,
    // which a workflow edit can reword with the rest never actually moving.
    const servedState = step.state
    const servedLabel = step.label

    const runner = yield* CommandRunner
    const fs = yield* FileSystem.FileSystem
    const uiListener = yield* UiListener
    const runtime = yield* Effect.runtime<UiRequirements>()

    const port = options.port ?? config?.port ?? DEFAULT_PORT
    const explicitHost = options.host ?? config?.host

    // T5: resolved ONCE, here, ahead of `uiListener.listen` — never inside
    // the request handler. The server lives for exactly one step, so a
    // mid-step `--dev` rebuild would have nothing left to reflect, and a
    // build per unauthenticated HTTP request was subprocess amplification
    // reachable by anything on the tailnet.
    const clientHtml = yield* resolveClientHtml(options.dev, runner, fs)

    const writeDeps: WriteDeps = {
      headSha: liveHeadSha,
      actorAt: liveActorAt,
      readFile: liveReadFile,
      writeFile: liveWriteFile,
    }
    const diffDeps: DiffDeps = { run: liveRunInWorktree }
    const readDeps: ReadSteeringFileDeps = { headSha: liveHeadSha, readFile: liveReadFile }

    // Resolved by `handOff` (scheduled on the HTTP response's `finish` event,
    // with a 2s fallback so a vanished client can't wedge the process) or by
    // the moved-on detection below (the outer loop advanced while this server
    // was up) — in place of the never-resolving wait a fleet server could get
    // away with, since this server outlives exactly one step, not the whole
    // process lifetime. `gtd ui` now ends through exactly these two doors —
    // no heuristic guesses at a closed tab (package 03 Task 8): a signal is
    // the only other way out, owned by whatever spawned this process.
    const handoffDeferred = yield* Deferred.make<void>()
    // `Deferred.succeed` on an already-resolved deferred is a documented
    // no-op (returns `false`, changes nothing) — safe to call from both
    // `handOff` and the moved-on detection with no extra guard, since
    // whichever fires first wins and the process still exits exactly once,
    // exit 0.
    const endServer = (): void => {
      Runtime.runFork(runtime)(Deferred.succeed(handoffDeferred, undefined))
    }

    // The `step` query's actual resolver — every read after startup is
    // compared against the rest captured above. A mismatched `state`, a read
    // that's gone broken, or one that's no longer renderable all mean the
    // outer loop moved on while this server was up: end it the SAME
    // idempotent way `handOff` does, one exit, exit 0, and hand the client a
    // `moved-on` read instead of a stale or now-unrenderable one. No polling
    // timer drives this — it rides the `step` query the client already
    // issues.
    const readServedStep = async (): Promise<StepRead> => {
      const read = await readStep({ path: cwd.root }, liveBeatDeps)
      const movedOn = read.status === "broken" || read.state !== servedState || !isRenderable(read)
      if (!movedOn) return read
      endServer()
      return { status: "moved-on", label: read.status === "ok" ? read.label : servedLabel }
    }

    // T4's confinement gate: every read/write is narrowed to the ONE file
    // the served step actually named at startup (`step.file`, captured
    // above) — never the whole worktree. Lives here, not inside
    // `writeNote`/`writeValue`/`readSteeringFile` themselves, because those
    // functions have no notion of "the step this server serves"; only the
    // context closing over `step` does. `"file-vanished"` reuses the
    // existing refusal rather than adding a seventh `WriteRefusalReason` —
    // a seventh value means a seventh client display sentence for a case
    // only a hand-rolled client (never the real phone UI, which only ever
    // requests `step.file`) could reach.
    const isServedFile = (filePath: string): boolean => filePath === step.file

    const trpcHandler = createHTTPHandler({
      router: appRouter,
      basePath: `${TRPC_PATH_PREFIX}/`,
      createContext: ({ res }): RouterContext => ({
        readStep: readServedStep,
        writeNote: (request) =>
          isServedFile(request.filePath)
            ? writeNote({ ...request, worktreePath: cwd.root }, writeDeps)
            : Promise.resolve({ ok: false, reason: "file-vanished" }),
        writeValue: (request) =>
          isServedFile(request.filePath)
            ? writeValue({ ...request, worktreePath: cwd.root }, writeDeps)
            : Promise.resolve({ ok: false, reason: "file-vanished" }),
        resolveDiff: (path, line) => resolveDiff(cwd.root, path, line, diffDeps),
        readSteeringFile: (request) =>
          isServedFile(request.filePath)
            ? readSteeringFile({ ...request, worktreePath: cwd.root }, readDeps)
            : Promise.resolve({ ok: false, reason: "file-vanished" }),
        handOff: () => {
          let settled = false
          const settle = (): void => {
            if (settled) return
            settled = true
            clearTimeout(fallback)
            endServer()
          }
          res.once("finish", settle)
          // Cleared the instant `finish` settles first (the normal path) —
          // `Cli.ts`'s success path sets `process.exitCode` rather than
          // calling `process.exit`, so an uncleared timer keeps the event
          // loop alive for its own full duration regardless of `settled`,
          // delaying every ordinary handoff by up to 2s for nothing.
          const fallback = setTimeout(settle, 2_000)
        },
      }),
    })

    const handler: RequestHandler = (req, res) => {
      if (req.url === TRPC_PATH_PREFIX || req.url?.startsWith(`${TRPC_PATH_PREFIX}/`)) {
        trpcHandler(req, res)
        return
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(clientHtml)
    }

    const { bound, url, teardown } = yield* resolveListener({
      options,
      config,
      port,
      explicitHost,
      worktree: cwd.root,
      uiListener,
      handler,
      out,
    })

    out.write(`${url}\n`)
    out.flush()
    yield* Deferred.await(handoffDeferred).pipe(
      Effect.ensuring(Effect.sync(() => bound.close()).pipe(Effect.andThen(teardown))),
    )
  })
