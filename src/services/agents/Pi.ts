import { Effect } from "effect"
import { execSync } from "node:child_process"
import type { AgentProvider, AgentInvocation } from "../Agent.js"
import { AgentEvents, type AgentEvent } from "../AgentEvent.js"
import { readJsonStream } from "./stream.js"

const findPiExecutable = (): string | undefined => {
  try {
    return execSync("which pi", { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}

export const parsePiEvent = (line: string): AgentEvent | undefined => {
  try {
    const data = JSON.parse(line)

    switch (data.type) {
      case "agent_start":
        return AgentEvents.agentStart()
      case "agent_end":
        return AgentEvents.agentEnd()
      case "turn_start":
        return AgentEvents.turnStart()
      case "turn_end": {
        const content = data.message?.content
        if (Array.isArray(content)) {
          const text = content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("")
          return AgentEvents.turnEnd(text)
        }
        return AgentEvents.turnEnd("")
      }
      case "message_update": {
        const evt = data.assistantMessageEvent
        if (evt?.type === "text_delta" && evt.delta) {
          return AgentEvents.textDelta(evt.delta)
        }
        return undefined
      }
      case "tool_execution_start":
        return AgentEvents.toolStart(data.toolName ?? "unknown")
      case "tool_execution_end":
        return AgentEvents.toolEnd(data.toolName ?? "unknown", data.isError ?? false)
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

  invoke: readJsonStream({
    agentName: "Pi",
    parseEvent: parsePiEvent,
    spawn: (params: AgentInvocation) => {
      const args = [
        "pi",
        "-p",
        "--mode",
        "json",
        "--no-session",
        ...(params.systemPrompt ? ["--append-system-prompt", params.systemPrompt] : []),
        params.prompt,
      ]
      const proc = Bun.spawn(args, {
        cwd: params.cwd,
        stdout: "pipe",
        stderr: "inherit",
      })
      return { proc }
    },
  }),
}
