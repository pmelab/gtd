import type { IncomingMessage, ServerResponse } from "node:http"
import * as https from "node:https"
import { fileURLToPath } from "node:url"
import { FileSystem } from "@effect/platform"
import { Context, Effect, Either, Layer, Runtime } from "effect"
import type { ArtifactOut } from "../Cli.js"
import { GtdError } from "../Commentary.js"
import { CommandRunner } from "../CommandRunner.js"
import type { ServeConfig } from "../ConfigSchema.js"
import generatedClientHtml from "../web/generated.html"
import { pickBindHostFromSystem } from "./Bind.js"
import { renderQrCode } from "./Qr.js"
import { generateSelfSignedCert, loadCertPair, type CertPair } from "./Tls.js"

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
  if (options.selfSigned) return generateSelfSignedCert({ host, ip: host })
  if (config?.cert !== undefined && config.key !== undefined) {
    return loadCertPair(config.cert, config.key)
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

/** The `<script type="module" src="./main.js"></script>` tag both `src/web/index.html` and `scripts/inline-web-client.mjs` key off — kept as one constant so the two never drift apart. */
const DEV_SCRIPT_TAG = /<script type="module" src="\.\/main\.js"><\/script>/

const clientSourceUrl = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url))

/** `--dev`: the raw template, read fresh off disk every call — editing it needs no rebuild. */
const readDevTemplate = (fs: FileSystem.FileSystem): Effect.Effect<string, GtdError> =>
  fs
    .readFileString(clientSourceUrl("../web/index.html"))
    .pipe(
      Effect.mapError(
        (e) => new GtdError(`gtd serve --dev: could not read src/web/index.html: ${e.message}`),
      ),
    )

/**
 * `--dev`: rebuilds the browser bundle via the same tsdown config `npm run
 * build` uses (`--filter web` selects only that config's `name`), then reads
 * its freshly-written output — the simplest way to reflect an edited client
 * source file with no manual `npm run build`. Costs one subprocess build per
 * request; acceptable for local development, never reached in production.
 */
const rebuildDevClientScript = (
  runner: Context.Tag.Service<typeof CommandRunner>,
  fs: FileSystem.FileSystem,
): Effect.Effect<string, GtdError> =>
  Effect.gen(function* () {
    const outcome = yield* runner
      .bash("npx tsdown --filter web")
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
      .readFileString(clientSourceUrl("../../dist/web/main.js"))
      .pipe(
        Effect.mapError(
          (e) => new GtdError(`gtd serve --dev: could not read the rebuilt client: ${e.message}`),
        ),
      )
  })

const renderHtml = (template: string, script: string): string =>
  template.replace(DEV_SCRIPT_TAG, `<script type="module">\n${script}\n</script>`)

/** The one piece of content this server ever serves: the client HTML, with its JS inlined — a build-time constant in production, freshly read/rebuilt per request under `--dev`. */
export const resolveClientHtml = (
  dev: boolean,
  runner: Context.Tag.Service<typeof CommandRunner>,
  fs: FileSystem.FileSystem,
): Effect.Effect<string, GtdError> =>
  dev
    ? Effect.all([readDevTemplate(fs), rebuildDevClientScript(runner, fs)]).pipe(
        Effect.map(([template, script]) => renderHtml(template, script)),
      )
    : Effect.succeed(generatedClientHtml)

export type ServeRequirements = CommandRunner | FileSystem.FileSystem | HttpsServer

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
    const runtime = yield* Effect.runtime<ServeRequirements>()

    const handler: RequestHandler = (_req, res) => {
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
