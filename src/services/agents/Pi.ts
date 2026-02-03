import { Effect } from "effect"
import { execSync } from "node:child_process"
import { AgentError, type AgentProvider, type AgentInvocation, type AgentResult } from "../Agent.js"
import { AgentEvent, type AgentEvent as AgentEventType } from "../AgentEvent.js"

const findPiExecutable = (): string | undefined => {
  try {
    return execSync("which pi", { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}

export const parsePiEvent = (line: string): AgentEventType | undefined => {
  try {
    const data = JSON.parse(line)

    switch (data.type) {
      case "agent_start":
        return AgentEvent.agentStart()
      case "agent_end":
        return AgentEvent.agentEnd()
      case "turn_start":
        return AgentEvent.turnStart()
      case "turn_end": {
        const content = data.message?.content
        if (Array.isArray(content)) {
          const text = content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("")
          return AgentEvent.turnEnd(text)
        }
        return AgentEvent.turnEnd("")
      }
      case "message_update": {
        const evt = data.assistantMessageEvent
        if (evt?.type === "text_delta" && evt.delta) {
          return AgentEvent.textDelta(evt.delta)
        }
        return undefined
      }
      case "tool_execution_start":
        return AgentEvent.toolStart(data.toolName ?? "unknown")
      case "tool_execution_end":
        return AgentEvent.toolEnd(data.toolName ?? "unknown", data.isError ?? false)
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

export const PiAgent: AgentProvider = {
  isAvailable: () =>
    Effect.try({
      try: () => findPiExecutable() !== undefined,
      catch: () => false,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),

  invoke: (params: AgentInvocation): Effect.Effect<AgentResult, AgentError> =>
    Effect.async<AgentResult, AgentError>((resume) => {
      const args = [
        "pi",
        "-p",
        "--mode",
        "json",
        "--no-session",
        ...(params.systemPrompt ? ["--append-system-prompt", params.systemPrompt] : []),
        params.prompt,
      ]

      const proc = Bun.spawn(args,
        {
          cwd: params.cwd,
          stdout: "pipe",
          stderr: "inherit",
        },
      )

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
              const event = parsePiEvent(line)
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
            resume(Effect.fail(new AgentError(`Pi exited with code ${code}`)))
          }
        })
      })

      return Effect.sync(() => {
        reader.cancel()
        proc.kill()
      })
    }),
}
