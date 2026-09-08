import { existsSync, readFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import * as https from "node:https"
import { isIP } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHTTPHandler } from "@trpc/server/adapters/standalone"
import { FileSystem } from "@effect/platform"
import { Context, Deferred, Effect, Either, Layer, Runtime } from "effect"
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
} from "./Beat.js"
import { pickBindHostFromSystem } from "./BindSystem.js"
import { resolveDiff, type DiffDeps } from "./Diff.js"
import { readSteeringFile, type ReadSteeringFileDeps } from "./ReadSteeringFile.js"
import { renderQrCode } from "./Qr.js"
import { appRouter, type RouterContext } from "./Router.js"
import { inlineScript } from "./scriptTag.mjs"
import { generateSelfSignedCert, loadCertPair, type CertPair } from "./Tls.js"
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

/** The one non-tRPC endpoint this server exposes — `main.tsx`'s `pagehide` beacon posts here (never a tRPC mutation: `navigator.sendBeacon` sends a plain body, not a tRPC batch envelope, and firing mid-unload rules out anything that needs to await a JSON round trip). */
const CLOSE_PATH = "/close"

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
 * `ui.host`, then a scan for a Tailscale interface — refusing only when
 * all three are absent, because a server that reads and writes working
 * trees without authentication must never silently appear on the LAN.
 * `pickHost` defaults to the real system scan but is a parameter so tests
 * can simulate "no tailnet" without touching `os.networkInterfaces()`.
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
 * Determines the certificate/key pair: `--self-signed` always wins (an
 * explicit ask, honored even if `ui.cert`/`ui.key` are also
 * configured), then a configured pair. Neither present is a refusal, not a
 * silent default to self-signed — that would mean an unexpected `openssl`
 * invocation on every plain `gtd ui`.
 */
export const resolveCertPair = (
  options: UiCommandOptions,
  config: UiConfig | undefined,
  host: string,
): Effect.Effect<CertPair, GtdError, CommandRunner | FileSystem.FileSystem> => {
  // openssl's `-addext subjectAltName=IP:...` rejects a non-literal value
  // outright (confirmed: a hostname `--host` like "localhost" fails with a
  // raw "Error Loading command line extensions" dump naming neither the
  // flag nor the cause). The Tailscale-scan default always yields a literal;
  // only an explicit hostname `--host` can land here as a non-literal.
  if (options.selfSigned) {
    return generateSelfSignedCert({ host, ...(isIP(host) !== 0 ? { ip: host } : {}) })
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
  return Effect.fail(
    new GtdError("gtd ui: HTTPS is mandatory and no certificate is configured", [
      "pass --self-signed for a throwaway certificate",
      "or configure ui.cert and ui.key",
    ]),
  )
}

/**
 * The subprocess/socket port for the actual TLS listen — isolated behind a
 * service tag (mirroring `CommandRunner`) so tests can swap in a fake
 * without a real socket bind or a real certificate.
 */
export class HttpsServer extends Context.Tag("HttpsServer")<
  HttpsServer,
  {
    readonly listen: (
      certPair: CertPair,
      host: string,
      port: number,
      handler: RequestHandler,
    ) => Effect.Effect<BoundServer, GtdError>
  }
>() {
  static readonly Live = Layer.succeed(HttpsServer, {
    listen: (certPair, host, port, handler) =>
      Effect.async<BoundServer, GtdError>((resume) => {
        // Unconditionally `https.createServer` — no code path in this module
        // ever constructs a plain `http.createServer`, because the Web
        // Speech API is secure-context-only and would lose dictation
        // silently over plain http.
        const server = https.createServer({ cert: certPair.cert, key: certPair.key }, handler)
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

/** `--dev`: the raw template, read fresh off disk every call — editing it needs no rebuild. */
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
 * to select against, since `ui` deliberately runs outside any repo. Costs
 * one subprocess build per request; acceptable for local development, never
 * reached in production.
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

/** The one piece of content this server ever serves: the client HTML, with its JS inlined — a build-time constant in production, freshly read/rebuilt per request under `--dev`. */
export const resolveClientHtml = (
  dev: boolean,
  runner: Context.Tag.Service<typeof CommandRunner>,
  fs: FileSystem.FileSystem,
): Effect.Effect<string, GtdError> =>
  dev
    ? findPackageRoot().pipe(
        Effect.flatMap((root) =>
          Effect.all([readDevTemplate(fs, root), rebuildDevClientScript(runner, fs, root)]),
        ),
        Effect.map(([template, script]) => inlineScript(template, script)),
      )
    : Effect.succeed(generatedClientHtml)

export type UiRequirements = CommandRunner | FileSystem.FileSystem | HttpsServer | Cwd

/** Every dependency `readStep` needs, wired to the real subprocess/filesystem reads — `gtd ui` never injects a fake here, unlike its own test suite. */
const liveBeatDeps = {
  run: liveRunInWorktree,
  readLocalGtdVersion: readLocalGtdVersionAt,
  headSha: liveHeadSha,
}

/**
 * `true` only for the one rest the phone client can actually render: a
 * `prompt` step (not idle) carrying a `file` and a `mode` that resolves to a
 * registered steering format. Every other rest — `message`/`script`/
 * `capture`/`stalled`, an idle worktree, an unreadable (`broken`) worktree,
 * or a `prompt` whose `mode` names nothing registered — has no screen.
 */
const isRenderable = (
  step: Step,
): step is Step & { readonly file: string; readonly mode: string } =>
  !step.idle &&
  step.kind === "prompt" &&
  step.file !== undefined &&
  step.mode !== undefined &&
  steeringFormatFor(step.mode) !== undefined

/**
 * The refusal named for whatever the served worktree actually rests at — an
 * unreadable worktree names the read failure verbatim; anything else names
 * the step's own `label` and `kind` (T1's own "no port bound" case), never a
 * generic "cannot start" with no further detail.
 */
const refusalFor = (
  step: Step | { readonly status: "broken"; readonly detail: string },
): GtdUsageError =>
  step.status === "broken"
    ? new GtdUsageError(`gtd ui: refuses to start — this worktree can't be read: ${step.detail}`)
    : new GtdUsageError(
        `gtd ui: refuses to start — "${step.label}" rests at ${step.kind}${step.idle ? " (idle)" : ""}, which has no phone screen`,
        ["gtd ui only renders a prompt step whose mode resolves to a registered steering format"],
      )

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

    const host = yield* resolveBindHost(options.host, config)
    const certPair = yield* resolveCertPair(options, config, host)
    const port = options.port ?? config?.port ?? DEFAULT_PORT

    const runner = yield* CommandRunner
    const fs = yield* FileSystem.FileSystem
    const httpsServer = yield* HttpsServer
    const runtime = yield* Effect.runtime<UiRequirements>()

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
    // `CLOSE_PATH` below (a human closing the tab with no handoff) — in
    // place of the never-resolving wait a fleet server could get away with,
    // since this server outlives exactly one step, not the whole process
    // lifetime.
    const handoffDeferred = yield* Deferred.make<void>()
    // `Deferred.succeed` on an already-resolved deferred is a documented
    // no-op (returns `false`, changes nothing) — safe to call from both
    // `handOff` and `CLOSE_PATH` with no extra guard, since whichever fires
    // first wins and the process still exits exactly once, exit 0.
    const endServer = (): void => {
      Runtime.runFork(runtime)(Deferred.succeed(handoffDeferred, undefined))
    }

    const trpcHandler = createHTTPHandler({
      router: appRouter,
      basePath: `${TRPC_PATH_PREFIX}/`,
      createContext: ({ res }): RouterContext => ({
        readStep: () => readStep({ path: cwd.root }, liveBeatDeps),
        writeNote: (request) => writeNote({ ...request, worktreePath: cwd.root }, writeDeps),
        writeValue: (request) => writeValue({ ...request, worktreePath: cwd.root }, writeDeps),
        resolveDiff: (path, line) => resolveDiff(cwd.root, path, line, diffDeps),
        readSteeringFile: (request) =>
          readSteeringFile({ ...request, worktreePath: cwd.root }, readDeps),
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
      // The human closed the tab (or navigated away) with no handoff —
      // `main.tsx` fires this off a `pagehide` listener via `sendBeacon`,
      // the one API browsers guarantee still delivers mid-unload. No note
      // was ever written (only `done` writes one), so the process exits 0
      // with the worktree exactly as `writeNote`/`done` last left it —
      // `endServer` is the SAME idempotent resolve `handOff` calls, so this
      // and a real handoff can never race into a double exit.
      if (req.method === "POST" && req.url === CLOSE_PATH) {
        req.resume()
        res.writeHead(204)
        res.end()
        endServer()
        return
      }
      Runtime.runPromise(runtime)(
        resolveClientHtml(options.dev, runner, fs).pipe(Effect.either),
      ).then((result) => {
        if (Either.isLeft(result)) {
          res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
          res.end(result.left.message)
          return
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end(result.right)
      })
    }

    const bound = yield* httpsServer.listen(certPair, host, port, handler)
    const url = `https://${host}:${bound.port}/`
    out.write(`${url}\n`)
    out.write(`${renderQrCode(url)}\n`)
    out.flush()
    yield* Deferred.await(handoffDeferred).pipe(Effect.ensuring(Effect.sync(() => bound.close())))
  })
