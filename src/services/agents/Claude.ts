import { Command, CommandExecutor } from "@effect/platform"
import { Effect, Stream } from "effect"
import { execSync } from "node:child_process"
import { AgentError, type AgentProvider, type AgentInvocation, type AgentResult } from "../Agent.js"
import { AgentEvents, type AgentEvent } from "../AgentEvent.js"

const findClaudeExecutable = (): string | undefined => {
  try {
    return execSync("which claude", { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}

export const parseClaudeEvent = (line: string): AgentEvent | undefined => {
  try {
    const data = JSON.parse(line)

    switch (data.type) {
      case "system":
        if (data.subtype === "init") return AgentEvents.agentStart()
        return undefined
      case "assistant": {
        const content = data.message?.content
        if (!Array.isArray(content)) return undefined

        const toolUse = content.find((b: { type: string }) => b.type === "tool_use")
        if (toolUse) {
          return AgentEvents.toolStart(toolUse.name ?? "unknown")
        }

        const textBlocks = content.filter((b: { type: string }) => b.type === "text")
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b: { text: string }) => b.text).join("")
          if (text) return AgentEvents.textDelta(text)
        }

        return undefined
      }
      case "result":
        return AgentEvents.agentEnd()
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
  model?: string
}): string[] => {
  const args = ["claude"]
  if (params.resumeSessionId) {
    args.push("--resume", params.resumeSessionId)
  }
  args.push("-p", "--verbose", "--output-format", "stream-json", "--include-partial-messages")
  if (params.systemPrompt && !params.resumeSessionId) {
    args.push("--system-prompt", params.systemPrompt)
  }
  if (params.model) {
    args.push("--model", params.model)
  }
  args.push("--dangerously-skip-permissions")
  return args
}

export const ClaudeAgent: AgentProvider = {
  name: "claude",
  providerType: "claude",
  isAvailable: () =>
    Effect.try({
      try: () => findClaudeExecutable() !== undefined,
      catch: () => false,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),

  invoke: (params: AgentInvocation): Effect.Effect<AgentResult, AgentError, CommandExecutor.CommandExecutor> => {
    const args = buildClaudeArgs({
      systemPrompt: params.systemPrompt,
      resumeSessionId: params.resumeSessionId,
      ...(params.model !== undefined ? { model: params.model } : {}),
    })
    const [cmd, ...rest] = args
    let sessionId: string | undefined

    const command = Command.make(cmd!, ...rest).pipe(
      Command.stdin(Stream.fromIterable([Buffer.from(params.prompt)])),
      Command.stderr("inherit"),
      Command.workingDirectory(params.cwd),
    )

    return Effect.gen(function* () {
      const proc = yield* Command.start(command)

      yield* proc.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.trim() !== ""),
        Stream.runForEach((line) =>
          Effect.sync(() => {
            const sid = extractSessionId(line)
            if (sid) sessionId = sid
            const event = parseClaudeEvent(line)
            if (event && params.onEvent) {
              params.onEvent(event)
            }
          }),
        ),
      )

      const exitCode = yield* proc.exitCode
      if (exitCode !== 0) {
        return yield* Effect.fail(new AgentError(`Claude exited with code ${exitCode}`))
      }
      return { sessionId }
    }).pipe(
      Effect.scoped,
      Effect.mapError((e) => (e instanceof AgentError ? e : new AgentError(String(e)))),
    )
  },
}
