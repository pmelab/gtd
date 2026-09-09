import { existsSync, readFileSync } from "node:fs"
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
 * exactly ONCE, ahead of `httpsServer.listen` (T5) — an HTTP request can no
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

/** The one piece of content this server ever serves: the client HTML, with its JS inlined — a build-time constant in production, resolved ONCE at startup under `--dev` too (T5) and held for the process's whole lifetime, never re-read or rebuilt per request. */
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

    const host = yield* resolveBindHost(options.host, config)
    const certPair = yield* resolveCertPair(options, config, host)
    const port = options.port ?? config?.port ?? DEFAULT_PORT

    const runner = yield* CommandRunner
    const fs = yield* FileSystem.FileSystem
    const httpsServer = yield* HttpsServer
    const runtime = yield* Effect.runtime<UiRequirements>()

    // T5: resolved ONCE, here, ahead of `httpsServer.listen` — never inside
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

    const bound = yield* httpsServer.listen(certPair, host, port, handler)
    const url = `https://${host}:${bound.port}/`
    out.write(`${url}\n`)
    out.write(`${renderQrCode(url)}\n`)
    out.flush()
    yield* Deferred.await(handoffDeferred).pipe(Effect.ensuring(Effect.sync(() => bound.close())))
  })
