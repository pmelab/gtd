import { Effect } from "effect"
import { cleanupPrompt, interpolate } from "../prompts/index.js"
import { AgentService } from "./Agent.js"

const MAX_SUBJECT_LENGTH = 72
const VALID_TYPES = ["feat", "fix", "refactor"] as const
const DEFAULT_SUBJECT = "refactor: remove todo file"

/**
 * Extract lines added in a git diff (strips the leading `+`, excludes `+++` header lines).
 */
export const extractAddedLines = (diff: string): string =>
  diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n")
    .trim()

/**
 * Generate a structured cleanup commit message from the workflow history.
 *
 * Format:
 *   🧹 cleanup: <LLM summary of seed>
 *
 *   ## Seed
 *
 *   <seed content>
 *
 *   ## Grill          ← omitted when grillDiffs is empty
 *
 *   <grill content>
 */
export const generateCleanupMessage = (
  seedDiff: string,
  grillDiffs: ReadonlyArray<string>,
  callbacks?: { onStart?: () => void; onStop?: () => void },
): Effect.Effect<string, never, AgentService> =>
  Effect.gen(function* () {
    const agent = yield* AgentService
    const seedContent = extractAddedLines(seedDiff)

    let text = ""
    callbacks?.onStart?.()
    yield* agent
      .invoke({
        prompt: interpolate(cleanupPrompt, { seed: seedContent }),
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

    const raw = text
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      ?.trim()

    // Validate the LLM response is a well-formed conventional commit subject
    const isValid =
      raw &&
      raw.length > 0 &&
      VALID_TYPES.some((t) => raw.startsWith(`${t}:`)) &&
      !raw.startsWith("🧹")

    const subject = isValid ? raw.slice(0, MAX_SUBJECT_LENGTH) : DEFAULT_SUBJECT

    // Build body
    const parts: string[] = [`## Seed\n\n${seedContent}`]

    const grillContent = grillDiffs
      .map(extractAddedLines)
      .filter((s) => s.length > 0)
      .join("\n\n")
      .trim()

    if (grillContent.length > 0) {
      parts.push(`## Grill\n\n${grillContent}`)
    }

    return `${subject}\n\n${parts.join("\n\n")}`
  })
