import assert from "node:assert"
import type { BeatDocument, TestRepo } from "../testkit/index.js"

const CONTENT_LINES = 5
const SUBJECTS = 5

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const beatLines = async (repo: TestRepo): Promise<string[]> => {
  try {
    const beat = await repo.next()
    const content = beat.content.trimEnd().split("\n")
    const more = content.length - CONTENT_LINES
    return [
      `step "${beat.state}" (${beat.kind}, ${beat.actor}${beat.idle ? ", idle" : ""})`,
      "content:",
      ...content.slice(0, CONTENT_LINES).map((line) => `  | ${line}`),
      ...(more > 0 ? [`  | … ${more} more lines`] : []),
    ]
  } catch (error) {
    return [`unknown — gtd next failed: ${reason(error)}`]
  }
}

/** Where the process rests, for a failed outcome to end with. Never throws: it describes a failure. */
export const restDescription = async (
  repo: () => TestRepo,
  neverUsed: readonly string[],
): Promise<string> => {
  let lines: string[]
  try {
    const r = repo()
    lines = [
      ...(await beatLines(r)),
      "last commits:",
      ...r
        .subjects()
        .slice(-SUBJECTS)
        .map((subject) => `  ${subject}`),
    ]
  } catch (error) {
    lines = [`unknown — ${reason(error)}`]
  }
  if (neverUsed.length > 0)
    lines.push(`actors never used: ${neverUsed.map((step) => `"${step}"`).join(", ")}`)
  return ["where the process rests:", ...lines.map((line) => `  ${line}`)].join("\n")
}

/** Both sides of a failed `contains`: the text looked for, and what was there. */
const containsFailure = (
  where: string,
  text: string,
  content: string | undefined,
  expected: boolean,
): string =>
  content === undefined
    ? `${where} does not exist${expected ? `, so it cannot contain "${text}"` : ""}`
    : `${where} ${expected ? "does not contain" : "contains"} "${text}"; it holds:\n${content}`

/** What `attempt` was refused with; fails when it was not refused at all. */
export const refusal = async (attempt: Promise<unknown>, expectation: string): Promise<string> => {
  try {
    await attempt
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  assert.fail(`expected a refusal ${expectation}, but nothing was refused`)
}

export const refusedWith = async (attempt: Promise<unknown>, message: string): Promise<void> => {
  const got = await refusal(attempt, `with "${message}"`)
  if (!got.includes(message))
    assert.fail(`expected a refusal with "${message}", but it was refused with:\n${got}`)
}

export const assertContains = (where: string, text: string, content: string | undefined): void => {
  if (content === undefined || !content.includes(text))
    assert.fail(containsFailure(where, text, content, true))
}

export const assertLacks = (where: string, text: string, content: string | undefined): void => {
  if (content === undefined || content.includes(text))
    assert.fail(containsFailure(where, text, content, false))
}

/** A rest at `step`; a stall there is no rest, so it points to the step that asserts one. */
export const assertRestsAt = (beat: BeatDocument, step: string): void => {
  if (beat.kind === "stalled")
    assert.fail(
      `expected a rest at "${step}", but the process stalls at "${beat.state}" — assert a stall with: the process stalls at "${beat.state}"`,
    )
  assert.strictEqual(beat.state, step)
}
