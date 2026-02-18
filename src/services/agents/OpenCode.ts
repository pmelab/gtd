import { Effect } from "effect"
import { execSync } from "node:child_process"
import type { AgentProvider, AgentInvocation } from "../Agent.js"
import { AgentEvents, type AgentEvent } from "../AgentEvent.js"
import { readJsonStream } from "./stream.js"

export const parseOpenCodeEvent = (line: string): AgentEvent | undefined => {
  try {
    const data = JSON.parse(line)

    switch (data.type) {
      case "step_start":
        return AgentEvents.turnStart()
      case "text":
        if (data.part?.text) {
          return AgentEvents.textDelta(data.part.text)
        }
        return undefined
      case "tool_call":
        return AgentEvents.toolStart(data.part?.tool ?? "unknown")
      case "tool_result":
        return AgentEvents.toolEnd(data.part?.tool ?? "unknown", data.part?.error ?? false)
      case "step_finish":
        return AgentEvents.turnEnd("")
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

export const buildOpenCodeArgs = (params: { model?: string }): string[] => {
  const args = ["opencode", "run", "--format", "json"]
  if (params.model) {
    args.push("--model", params.model)
  }
  return args
}

export const OpenCodeAgent: AgentProvider = {
  name: "opencode",
  providerType: "opencode",
  isAvailable: () =>
    Effect.try({
      try: () => {
        execSync("which opencode", { stdio: "ignore" })
        return true
      },
      catch: () => false,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),

  invoke: readJsonStream({
    agentName: "OpenCode",
    parseEvent: parseOpenCodeEvent,
    spawn: (params: AgentInvocation) => {
      const combinedPrompt = params.systemPrompt
        ? `${params.systemPrompt}\n\n${params.prompt}`
        : params.prompt
      const args = buildOpenCodeArgs({ model: params.model })
      const proc = Bun.spawn(args, {
        cwd: params.cwd,
        stdin: new Blob([combinedPrompt]),
        stdout: "pipe",
        stderr: "inherit",
      })
      return { proc }
    },
  }),
}
