import { Effect } from "effect"
import { execSync } from "node:child_process"
import { AgentError, type AgentProvider, type AgentInvocation, type AgentResult } from "../Agent.js"
import { AgentEvent, type AgentEvent as AgentEventType } from "../AgentEvent.js"

export const parseOpenCodeEvent = (line: string): AgentEventType | undefined => {
  try {
    const data = JSON.parse(line)

    switch (data.type) {
      case "step_start":
        return AgentEvent.turnStart()
      case "text":
        if (data.part?.text) {
          return AgentEvent.textDelta(data.part.text)
        }
        return undefined
      case "tool_call":
        return AgentEvent.toolStart(data.part?.tool ?? "unknown")
      case "tool_result":
        return AgentEvent.toolEnd(data.part?.tool ?? "unknown", data.part?.error ?? false)
      case "step_finish":
        return AgentEvent.turnEnd("")
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

export const OpenCodeAgent: AgentProvider = {
  isAvailable: () =>
    Effect.try({
      try: () => {
        execSync("which opencode", { stdio: "ignore" })
        return true
      },
      catch: () => false,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),

  invoke: (params: AgentInvocation): Effect.Effect<AgentResult, AgentError> =>
    Effect.async<AgentResult, AgentError>((resume) => {
      const combinedPrompt = params.systemPrompt
        ? `${params.systemPrompt}\n\n${params.prompt}`
        : params.prompt

      const proc = Bun.spawn(["opencode", "run", "--format", "json"], {
        cwd: params.cwd,
        stdin: new Blob([combinedPrompt]),
        stdout: "pipe",
        stderr: "inherit",
      })

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
              const event = parseOpenCodeEvent(line)
              if (event && params.onEvent) {
                params.onEvent(event)
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
            resume(Effect.fail(new AgentError(`OpenCode exited with code ${code}`)))
          }
        })
      })

      return Effect.sync(() => {
        reader.cancel()
        proc.kill()
      })
    }),
}
