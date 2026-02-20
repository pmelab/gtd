import { Command } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { Effect, Stream } from "effect"
import { AgentError, type AgentInvocation, type AgentResult } from "../Agent.js"

export interface StreamAgentOptions {
  readonly buildCommand: (params: AgentInvocation) => Command.Command
  readonly parseEvent: (line: string) => unknown | undefined
  readonly onLine?: (line: string) => void
  readonly agentName: string
}

export const readJsonStream =
  (options: StreamAgentOptions) =>
  (params: AgentInvocation): Effect.Effect<AgentResult, AgentError> =>
    Effect.gen(function* () {
      const command = options.buildCommand(params)
      const proc = yield* Command.start(command)

      yield* proc.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.trim() !== ""),
        Stream.runForEach((line) =>
          Effect.sync(() => {
            options.onLine?.(line)
            const event = options.parseEvent(line)
            if (event && params.onEvent) {
              params.onEvent(event as never)
            }
          }),
        ),
      )

      const exitCode = yield* proc.exitCode
      if (exitCode !== 0) {
        return yield* Effect.fail(new AgentError(`${options.agentName} exited with code ${exitCode}`))
      }
      return { sessionId: undefined }
    }).pipe(
      Effect.scoped,
      Effect.mapError((e) => (e instanceof AgentError ? e : new AgentError(String(e)))),
      Effect.provide(NodeContext.layer),
    )
