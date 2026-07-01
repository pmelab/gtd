import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Stream } from "effect"
import { ConfigService } from "./Config.js"

export interface TestResult {
  readonly exitCode: number
  /** Combined stdout+stderr, captured verbatim. */
  readonly output: string
}

export interface TestRunnerOperations {
  /**
   * Runs the configured test command.
   * - Spawn failure (binary missing / ENOENT) → typed `Error` (fails the Effect)
   * - Non-zero test exit → `TestResult` with non-zero `exitCode` (data, not error)
   */
  readonly run: () => Effect.Effect<TestResult, Error>
}

export class TestRunner extends Context.Tag("TestRunner")<TestRunner, TestRunnerOperations>() {
  static Live = Layer.effect(
    TestRunner,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor
      // The test command now comes from `ConfigService` (default `npm run test`).
      // `ConfigService` is NOT baked in here — it stays a requirement of this
      // layer, provided at the composition root (main.ts), like `GitService`.
      const config = yield* ConfigService

      // Tokenize by whitespace split into argv. NOTE: quoting/escaping is NOT
      // supported (whitespace-split only); the default "npm run test" yields
      // ["npm", "run", "test"]. A non-empty command is guaranteed by the config
      // default, so `head` is always present.
      const tokens = config.testCommand.split(/\s+/).filter((s) => s.length > 0)
      // `head` is the executable; `rest` its args. Fall back to "npm" if the
      // configured command is blank, so `Command.make` always gets a valid head.
      const [head = "npm", ...rest] = tokens

      return {
        run: () =>
          Effect.scoped(
            Effect.gen(function* () {
              // Pipe both streams so we can capture stdout and stderr combined.
              const command = Command.make(head, ...rest).pipe(
                Command.stdout("pipe"),
                Command.stderr("pipe"),
              )

              const process = yield* executor.start(command)

              const collect = (stream: Stream.Stream<Uint8Array, unknown>) =>
                stream.pipe(Stream.decodeText(), Stream.mkString)

              // Drain stdout and stderr concurrently while awaiting the exit code,
              // so neither stream blocks on a full pipe buffer.
              const [stdout, stderr, exitCode] = yield* Effect.all(
                [collect(process.stdout), collect(process.stderr), process.exitCode],
                { concurrency: "unbounded" },
              )

              return { exitCode: Number(exitCode), output: stdout + stderr } satisfies TestResult
            }),
          ).pipe(
            Effect.catchAll((cause) => {
              // Distinguish spawn failure (binary missing / ENOENT) from other
              // errors. @effect/platform surfaces spawn-ENOENT as a SystemError
              // whose message contains "ENOENT" or whose `reason` is "NotFound".
              // Both produce a typed Error so main.ts's catchAll surfaces it on
              // stderr with exit 1.
              const causeStr = cause instanceof Error ? cause.message : String(cause)
              const isNotFound =
                causeStr.includes("ENOENT") ||
                causeStr.includes("NotFound") ||
                (cause instanceof Error &&
                  "code" in cause &&
                  (cause as NodeJS.ErrnoException).code === "ENOENT")
              const msg = isNotFound
                ? `test command not found: ${head}`
                : `test command failed to start: ${causeStr}`
              return Effect.fail(new Error(msg))
            }),
          ),
      }
    }),
  )
}
