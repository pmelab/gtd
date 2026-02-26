import { Effect } from "effect"
import { commitPrompt, interpolate } from "../prompts/index.js"
import { AgentService } from "./Agent.js"

const MAX_LENGTH = 72

export const generateCommitMessage = (
  emoji: string,
  diff: string,
  callbacks?: { onStart?: () => void; onStop?: () => void },
): Effect.Effect<string, never, AgentService> =>
  Effect.gen(function* () {
    const agent = yield* AgentService

    let text = ""
    callbacks?.onStart?.()
    yield* agent
      .invoke({
        prompt: interpolate(commitPrompt, { diff }),
        systemPrompt: "",
        mode: "commit",
        cwd: process.cwd(),
        onEvent: (event) => {
          if (event._tag === "TextDelta") {
            text += event.delta
          }
        },
      })
      .pipe(
        Effect.ensuring(Effect.sync(() => callbacks?.onStop?.())),
        Effect.catchAll(() => Effect.succeed({ sessionId: undefined })),
      )

    const summary = text
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      ?.trim()

    if (!summary || summary.length === 0) {
      return `${emoji} update`
    }

    const prefix = `${emoji} `
    const maxDescLen = MAX_LENGTH - prefix.length
    const truncated = summary.length > maxDescLen ? summary.slice(0, maxDescLen) : summary

    return `${prefix}${truncated}`
  })
