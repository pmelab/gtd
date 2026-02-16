import { Effect } from "effect"
import { AgentError, type AgentInvocation, type AgentResult } from "../Agent.js"

export interface StreamAgentOptions {
  readonly spawn: (params: AgentInvocation) => {
    proc: { stdout: ReadableStream<Uint8Array>; exited: Promise<number>; kill: () => void }
  }
  readonly parseEvent: (line: string) => unknown | undefined
  readonly onLine?: (line: string) => void
  readonly agentName: string
}

export const readJsonStream = (
  options: StreamAgentOptions,
) => (params: AgentInvocation): Effect.Effect<AgentResult, AgentError> =>
  Effect.async<AgentResult, AgentError>((resume) => {
    const { proc } = options.spawn(params)

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    const readStream = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.trim()) continue
            options.onLine?.(line)
            const event = options.parseEvent(line)
            if (event && params.onEvent) {
              params.onEvent(event as never)
            }
          }
        }
      } catch {
        // Stream read error - will be handled by exit code check
      }
    }

    readStream().then(() => {
      proc.exited.then((code) => {
        if (code === 0) {
          resume(Effect.succeed({ sessionId: undefined }))
        } else {
          resume(Effect.fail(new AgentError(`${options.agentName} exited with code ${code}`)))
        }
      })
    })

    return Effect.sync(() => {
      reader.cancel()
      proc.kill()
    })
  })
