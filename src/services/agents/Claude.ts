import { Effect } from "effect"
import { execSync } from "node:child_process"
import { AgentError, type AgentProvider, type AgentInvocation, type AgentResult } from "../Agent.js"
import { AgentEvent, type AgentEvent as AgentEventType } from "../AgentEvent.js"

const findClaudeExecutable = (): string | undefined => {
  try {
    return execSync("which claude", { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}

export const parseClaudeEvent = (line: string): AgentEventType | undefined => {
  try {
    const data = JSON.parse(line)

    switch (data.type) {
      case "system":
        if (data.subtype === "init") return AgentEvent.agentStart()
        return undefined
      case "assistant": {
        const content = data.message?.content
        if (!Array.isArray(content)) return undefined

        const toolUse = content.find((b: { type: string }) => b.type === "tool_use")
        if (toolUse) {
          return AgentEvent.toolStart(toolUse.name ?? "unknown")
        }

        const textBlocks = content.filter((b: { type: string }) => b.type === "text")
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b: { text: string }) => b.text).join("")
          if (text) return AgentEvent.textDelta(text)
        }

        return undefined
      }
      case "result":
        return AgentEvent.agentEnd()
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

export const extractSessionId = (line: string): string | undefined => {
  try {
    const data = JSON.parse(line)
    if (data.type === "result" && typeof data.session_id === "string") {
      return data.session_id
    }
    return undefined
  } catch {
    return undefined
  }
}

export const buildClaudeArgs = (params: {
  systemPrompt: string
  resumeSessionId: string | undefined
}): string[] => {
  const args = ["claude"]
  if (params.resumeSessionId) {
    args.push("--resume", params.resumeSessionId)
  }
  args.push("-p", "--verbose", "--output-format", "stream-json", "--include-partial-messages")
  if (params.systemPrompt && !params.resumeSessionId) {
    args.push("--system-prompt", params.systemPrompt)
  }
  args.push("--dangerously-skip-permissions")
  return args
}

export const ClaudeAgent: AgentProvider = {
  isAvailable: () =>
    Effect.try({
      try: () => findClaudeExecutable() !== undefined,
      catch: () => false,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),

  invoke: (params: AgentInvocation): Effect.Effect<AgentResult, AgentError> =>
    Effect.async<AgentResult, AgentError>((resume) => {
      let sessionId: string | undefined
      const args = buildClaudeArgs({
        systemPrompt: params.systemPrompt,
        resumeSessionId: params.resumeSessionId,
      })

      const proc = Bun.spawn(args,
        {
          cwd: params.cwd,
          stdin: new Blob([params.prompt]),
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
              const sid = extractSessionId(line)
              if (sid) sessionId = sid
              const event = parseClaudeEvent(line)
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
            resume(Effect.succeed({ sessionId }))
          } else {
            resume(Effect.fail(new AgentError(`Claude exited with code ${code}`)))
          }
        })
      })

      return Effect.sync(() => {
        reader.cancel()
        proc.kill()
      })
    }),
}
