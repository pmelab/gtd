import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Stream } from "effect"

export interface TestResult {
  readonly exitCode: number
  /** Combined stdout+stderr, captured verbatim. */
  readonly output: string
}

export interface TestRunnerOperations {
  /** Runs `npm run test`, never fails the Effect — non-zero exit is data, not error. */
  readonly run: () => Effect.Effect<TestResult>
}

export class TestRunner extends Context.Tag("TestRunner")<TestRunner, TestRunnerOperations>() {
  static Live = Layer.effect(
    TestRunner,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor

      return {
        run: () =>
          Effect.scoped(
            Effect.gen(function* () {
              // Hardcoded command per the plan: `npm run test`. Pipe both streams
              // so we can capture stdout and stderr into one combined output.
              const command = Command.make("npm", "run", "test").pipe(
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
          ).pipe(Effect.orDie),
      }
    }),
  )
}
