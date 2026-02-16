import { Effect } from "effect"
import { AgentService } from "./Agent.js"

const MAX_LENGTH = 72

const PROMPT = (diff: string) =>
  `Summarize this diff as a git commit message (max 60 chars, no emoji, no prefix, lowercase start, imperative mood). Reply with ONLY the commit message, nothing else.\n\n\`\`\`diff\n${diff}\n\`\`\``

export const generateCommitMessage = (
  emoji: string,
  diff: string,
): Effect.Effect<string, never, AgentService> =>
  Effect.gen(function* () {
    const agent = yield* AgentService

    let text = ""
    yield* agent
      .invoke({
        prompt: PROMPT(diff),
        systemPrompt: "",
        mode: "plan",
        cwd: process.cwd(),
        onEvent: (event) => {
          if (event._tag === "TextDelta") {
            text += event.delta
          }
        },
      })
      .pipe(Effect.catchAll(() => Effect.succeed({ sessionId: undefined })))

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
