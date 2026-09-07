import { existsSync, readFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import * as https from "node:https"
import { isIP } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHTTPHandler } from "@trpc/server/adapters/standalone"
import { FileSystem } from "@effect/platform"
import { Context, Effect, Either, Layer, Runtime } from "effect"
import type { ArtifactOut } from "../Cli.js"
import { GtdError } from "../Commentary.js"
import { CommandRunner } from "../CommandRunner.js"
import type { ServeConfig } from "../ConfigSchema.js"
import { Cwd } from "../Cwd.js"
import generatedClientHtml from "../web/generated.html"
import {
  BeatCache,
  liveHeadSha,
  liveRunInWorktree,
  liveStatMtime,
  readLocalGtdVersionAt,
} from "./Beat.js"
import { pickBindHostFromSystem } from "./Bind.js"
import { readFleet, type FleetDeps } from "./Fleet.js"
import { renderQrCode } from "./Qr.js"
import { appRouter, type RouterContext } from "./Router.js"
import { inlineScript } from "./scriptTag.mjs"
import { generateSelfSignedCert, loadCertPair, type CertPair } from "./Tls.js"
import { liveActorAt, liveReadFile, liveWriteFile, writeNote, type WriteDeps } from "./Write.js"

/** `/trpc` prefix: everything under it is the tRPC API surface; everything else keeps serving the client HTML exactly as before. */
const TRPC_PATH_PREFIX = "/trpc"

/** The fields `Cli.ts`'s parsed `{ kind: "serve" }` command carries — this module never reads `Command` itself to stay independent of its parsing. */
export interface ServeCommandOptions {
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
 * `serve.host`, then a scan for a Tailscale interface — refusing only when
 * all three are absent, because a server that reads and writes working
 * trees without authentication must never silently appear on the LAN.
 * `pickHost` defaults to the real system scan but is a parameter so tests
 * can simulate "no tailnet" without touching `os.networkInterfaces()`.
 */
export const resolveBindHost = (
  host: string | undefined,
  config: ServeConfig | undefined,
  pickHost: () => string | undefined = pickBindHostFromSystem,
): Effect.Effect<string, GtdError> => {
  const resolved = host ?? config?.host ?? pickHost()
  return resolved === undefined
    ? Effect.fail(
        new GtdError("gtd serve: no Tailscale interface found to bind to, and no --host given", [
          "join a tailnet, so a CGNAT (100.64.0.0/10) address is available",
          "or pass --host <address> to bind explicitly",
        ]),
      )
    : Effect.succeed(resolved)
}

/**
 * Determines the certificate/key pair: `--self-signed` always wins (an
 * explicit ask, honored even if `serve.cert`/`serve.key` are also
 * configured), then a configured pair. Neither present is a refusal, not a
 * silent default to self-signed — that would mean an unexpected `openssl`
 * invocation on every plain `gtd serve`.
 */
export const resolveCertPair = (
  options: ServeCommandOptions,
  config: ServeConfig | undefined,
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
    const missing = config.cert === undefined ? "serve.cert" : "serve.key"
    return Effect.fail(
      new GtdError(`gtd serve: ${missing} is not configured — both cert and key are required`, [
        `serve.${config.cert === undefined ? "key" : "cert"} is configured, but ${missing} is not`,
        "pass --self-signed for a throwaway certificate instead",
      ]),
    )
  }
  return Effect.fail(
    new GtdError("gtd serve: HTTPS is mandatory and no certificate is configured", [
      "pass --self-signed for a throwaway certificate",
      "or configure serve.cert and serve.key",
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
                ? new GtdError(`gtd serve: port ${port} is already in use`)
                : new GtdError(`gtd serve: could not start the server: ${err.message}`),
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
 * which `serve` deliberately runs outside of (see `needsOf("serve")`). Walks
 * up from this module's own file — `src/serve/Server.ts` in a source checkout,
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
      new GtdError(
        "gtd serve --dev: could not locate the gtd source checkout to rebuild the client",
        [
          "--dev is for developing gtd's own web client: run it from a",
          "checked-out gtd repository with devDependencies installed",
        ],
      ),
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
        (e) => new GtdError(`gtd serve --dev: could not read src/web/index.html: ${e.message}`),
      ),
    )

/**
 * `--dev`: rebuilds the browser bundle via the same tsdown config `npm run
 * build` uses (`--filter web` selects only that config's `name`), then reads
 * its freshly-written output — the simplest way to reflect an edited client
 * source file with no manual `npm run build`. Runs with `root` (the gtd
 * package's OWN directory, never the invoking cwd) as its working directory —
 * a plain `npx tsdown` in the invoking directory would have no tsdown.config.ts
 * to select against, since `serve` deliberately runs outside any repo. Costs
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
          (e) => new GtdError(`gtd serve --dev: could not rebuild the client: ${e.message}`),
        ),
      )
    if (outcome.status !== 0) {
      return yield* Effect.fail(
        new GtdError(
          "gtd serve --dev: rebuilding the client failed",
          outcome.output.trim().split("\n").filter(Boolean),
        ),
      )
    }
    return yield* fs
      .readFileString(join(root, "dist/web/main.js"))
      .pipe(
        Effect.mapError(
          (e) => new GtdError(`gtd serve --dev: could not read the rebuilt client: ${e.message}`),
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

export type ServeRequirements = CommandRunner | FileSystem.FileSystem | HttpsServer | Cwd

/**
 * `gtd serve`: binds an HTTPS server exposing the phone/web client. Blocks
 * forever on success (mirrors `gtd visualize`'s `Effect.never` pattern) —
 * the process only exits on Ctrl-C or a bind refusal.
 */
export const runServeCommand = (
  options: ServeCommandOptions,
  config: ServeConfig | undefined,
  out: ArtifactOut,
): Effect.Effect<void, GtdError, ServeRequirements> =>
  Effect.gen(function* () {
    const host = yield* resolveBindHost(options.host, config)
    const certPair = yield* resolveCertPair(options, config, host)
    const port = options.port ?? config?.port ?? DEFAULT_PORT

    const runner = yield* CommandRunner
    const fs = yield* FileSystem.FileSystem
    const httpsServer = yield* HttpsServer
    const cwd = yield* Cwd
    const runtime = yield* Effect.runtime<ServeRequirements>()

    // One `BeatCache` for the whole server process, never one per request —
    // T3's memo only amortizes the `gtd next --json` cost if it survives
    // across fleet reads.
    const beatCache = new BeatCache({
      run: liveRunInWorktree,
      readLocalGtdVersion: readLocalGtdVersionAt,
      headSha: liveHeadSha,
      statMtime: liveStatMtime,
    })
    const fleetDeps: FleetDeps = {
      roots: config?.roots ?? [cwd.root],
      readBeat: (worktree) => beatCache.read(worktree),
    }

    const writeDeps: WriteDeps = {
      headSha: liveHeadSha,
      actorAt: liveActorAt,
      readFile: liveReadFile,
      writeFile: liveWriteFile,
    }

    const trpcHandler = createHTTPHandler({
      router: appRouter,
      basePath: `${TRPC_PATH_PREFIX}/`,
      createContext: (): RouterContext => ({
        runtime,
        readFleet: () => readFleet(fleetDeps),
        writeNote: (request) => writeNote(request, writeDeps),
      }),
    })

    const handler: RequestHandler = (req, res) => {
      if (req.url === TRPC_PATH_PREFIX || req.url?.startsWith(`${TRPC_PATH_PREFIX}/`)) {
        trpcHandler(req, res)
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
    yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => bound.close())))
  })
