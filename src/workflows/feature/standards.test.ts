import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  files: {} as Record<string, string | undefined>,
  vars: { standardMinP: "0.8" } as Record<string, string>,
  answers: {} as Record<string, { answer: string; p: number } | undefined>,
  judged: [] as string[][],
  written: {} as Record<string, string>,
}))

vi.mock("../../flows/index.js", async (original) => ({
  ...(await original<typeof import("../../flows/index.js")>()),
  read: (path: string) => state.files[path],
  vars: state.vars,
  judge: async (_: string, spec: { questions: { id: string }[] }) => {
    state.judged.push(spec.questions.map((q) => q.id))
    return { answers: state.answers, truncated: [] }
  },
  run: async (_: string, script: string) => {
    const path = /> '([^']+)'/.exec(script)?.[1] ?? ""
    const content = /printf '%s' '((?:[^']|'\\'')*)'/.exec(script)?.[1] ?? ""
    state.written[path] = content.replaceAll("'\\''", "'")
  },
}))

import type { ReviewDecision } from "../../steering/index.js"
import { learnStandards } from "./standards.js"

const STANDARDS = ".gtd/STANDARDS.md"

const file = (...lines: string[]): string =>
  [
    "# Standards",
    "",
    "Learned from your review answers and read by every agent turn. Edit freely.",
    "",
    ...lines,
    "",
  ].join("\n")

const answer = (anchor: string, text: string): ReviewDecision => ({
  anchor,
  body: "",
  choice: "answer",
  text,
})

const yes = { answer: "yes", p: 0.9 }
const no = { answer: "no", p: 0.9 }
const kept = () => state.written[STANDARDS]

beforeEach(() => {
  state.files = { ".gtd/REVIEW.md": "# Review\n" }
  state.vars.standardMinP = "0.8"
  state.answers = {}
  state.judged = []
  state.written = {}
})

describe("learnStandards", () => {
  it("asks a later candidate about each earlier one, and holds a contradiction for the human", async () => {
    state.answers = { "standard-1": yes, "standard-2": yes, "standard-2.contradicts-new-1": yes }
    await learnStandards([answer("A", "Use classes."), answer("B", "Never use classes.")])
    expect(state.judged[0]).toContain("standard-2.contradicts-new-1")
    expect(kept()).toBe(
      file(
        "- Use classes. (re: A)",
        "",
        "## Undecided",
        "",
        "- Never use classes. (re: B)",
        "  - contradicts: Use classes. (re: A)",
      ),
    )
  })

  it("raises a contradiction ruled out below the threshold", async () => {
    state.files[STANDARDS] = file("- Old.")
    state.answers = { "standard-1": yes, "standard-1.contradicts-1": { answer: "no", p: 0.5 } }
    await learnStandards([answer("A", "New.")])
    expect(kept()).toBe(
      file("- Old.", "", "## Undecided", "", "- New. (re: A)", "  - contradicts: Old."),
    )
  })

  it("keeps one the judge confidently calls compatible", async () => {
    state.files[STANDARDS] = file("- Old.")
    state.answers = { "standard-1": yes, "standard-1.contradicts-1": no }
    await learnStandards([answer("A", "New.")])
    expect(kept()).toBe(file("- Old.", "- New. (re: A)"))
  })

  it("asks no judge when standardMinP is blank", async () => {
    state.vars.standardMinP = ""
    await learnStandards([answer("A", "New.")])
    expect(state.judged).toEqual([])
    expect(state.written).toEqual({})
  })

  it("points another conflict at the standard that replaced its old one", async () => {
    state.files[STANDARDS] = file(
      "- O.",
      "",
      "## Undecided",
      "",
      "- A.",
      "  - contradicts: O.",
      "- B.",
      "  - contradicts: O.",
    )
    // The conflict note's title hashes its new standard, "A.".
    await learnStandards([
      { anchor: "Standard conflict 80d5a5c6", body: "", choice: "fix", text: "" },
    ])
    expect(kept()).toBe(file("- A.", "", "## Undecided", "", "- B.", "  - contradicts: A."))
  })
})
