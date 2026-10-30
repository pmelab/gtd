import { Duration, Effect, FileSystem, type PlatformError, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { ChildProcess, ChildProcessSpawner } from "effect/process"

export type ClaudeOutcome =
  | {
      readonly kind: "exited"
      readonly code: number
      readonly stdout: string
      readonly stderr: string
    }
  | { readonly kind: "missing" }
  | { readonly kind: "timeout" }
  | { readonly kind: "unstartable"; readonly message: string }

export interface ClaudeCall {
  readonly argv: readonly string[]
  readonly stdin: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly timeoutMs: number
}

export interface PostCall {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  /** Sent as `application/json`. */
  readonly json: string
  readonly timeoutMs: number
}

/**
 * What a judge reaches outside the process. `liveJudgeIo` reads, posts and
 * spawns through Effect's services; an in-memory twin answers from a fake
 * repository and scripted replies, and `tests/tooling/judge-io.test.ts` holds
 * the two to the same answers.
 */
export interface JudgeIo {
  /** `undefined` for an absent file; any other failure rejects. */
  readonly readFile: (path: string) => Promise<string | undefined>
  /** Rejects when no response arrives; any status is a response. */
  readonly post: (call: PostCall) => Promise<{ readonly status: number; readonly text: string }>
  readonly claude: (call: ClaudeCall) => Promise<ClaudeOutcome>
}

const isNotFound = (e: PlatformError.PlatformError): boolean => e.reason._tag === "NotFound"

// What fetch itself said (a refused connection, a failed lookup), not just which request failed.
const postFailure = (e: {
  readonly message: string
  readonly reason?: { readonly cause?: unknown }
}) => new Error(e.reason?.cause instanceof Error ? e.reason.cause.message : e.message)

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString)

const runClaude =
  (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  ({ argv, stdin, env, cwd, timeoutMs }: ClaudeCall): Effect.Effect<ClaudeOutcome> =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make("claude", [...argv], {
            cwd,
            env: { ...env },
            stdin: Stream.make(new TextEncoder().encode(stdin)),
            stdout: "pipe",
            stderr: "pipe",
            killSignal: "SIGKILL",
            // Like execFile: claude stays in gtd's process group, so Ctrl-C reaches it.
            detached: false,
          }),
        )
        const [stdout, stderr, code] = yield* Effect.all(
          [collect(child.stdout), collect(child.stderr), child.exitCode],
          { concurrency: "unbounded" },
        )
        return { kind: "exited", code, stdout, stderr } satisfies ClaudeOutcome
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () => Effect.succeed<ClaudeOutcome>({ kind: "timeout" }),
      }),
      Effect.catch((e) =>
        Effect.succeed<ClaudeOutcome>(
          isNotFound(e) ? { kind: "missing" } : { kind: "unstartable", message: e.message },
        ),
      ),
    )

const makeJudgeIo = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const http = yield* HttpClient.HttpClient
  return {
    readFile: (path) =>
      Effect.runPromise(
        fs.readFileString(path).pipe(
          Effect.catchIf(isNotFound, () => Effect.succeed(undefined)),
          Effect.mapError((e) => new Error(e.message)),
        ),
      ),
    post: ({ url, headers, json, timeoutMs }) =>
      Effect.runPromise(
        http
          .execute(
            HttpClientRequest.post(url).pipe(
              HttpClientRequest.setHeaders(headers),
              HttpClientRequest.bodyText(json, "application/json"),
            ),
          )
          .pipe(
            Effect.flatMap((res) => Effect.map(res.text, (text) => ({ status: res.status, text }))),
            Effect.timeout(Duration.millis(timeoutMs)),
            Effect.mapError(postFailure),
            // A third-party API gets no trace headers.
            Effect.provideService(HttpClient.TracerPropagationEnabled, false),
          ),
      ),
    claude: (call) => Effect.runPromise(runClaude(spawner)(call)),
  } satisfies JudgeIo
})

/** The fetch-backed client lives here, not at the root, so it loads only with the judge. */
export const liveJudgeIo: Effect.Effect<
  JudgeIo,
  never,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> = makeJudgeIo.pipe(Effect.provide(FetchHttpClient.layer))
