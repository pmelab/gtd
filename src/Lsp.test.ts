import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import {
  questionSymbols,
  reviewSymbols,
  toggleHunkEdit,
  toggleChunkEdits,
  reviewCodeActions,
  currentSteeringFile,
  STATE_FILE,
} from "./Lsp.js"
import { InMemRepo } from "../tests/integration/support/inmem/Repo.js"
import { inMemoryLayers } from "../tests/integration/support/inmem/layers.js"

const questionsDoc = [
  "# Plan",
  "",
  "## Open Questions",
  "",
  "### Which operations?",
  "",
  "Suggested default: add and subtract.",
  "",
  "### What is the target platform?",
  "",
  "Answer: web only.",
  "",
].join("\n")

const reviewDoc = [
  "# Review: abc1234",
  "<!-- base: abc1234def5678901234567890123456789abcd -->",
  "",
  "## Add calculator",
  "",
  "- [ ] ./src/calc.ts#1",
  "- [x] ./src/calc.ts#5 — subtract",
  "",
  "## Wire it up",
  "",
  "- [ ] ./src/index.ts#10",
  "",
].join("\n")

describe("questionSymbols", () => {
  it("maps each open question to a symbol carrying its status and heading position", () => {
    const symbols = questionSymbols(questionsDoc)
    expect(symbols.map((s) => s.name)).toEqual([
      "[suggested] Which operations?",
      "[answered] What is the target platform?",
    ])
    expect(symbols[0]?.selectionRange.start.line).toBe(4)
    expect(symbols[1]?.selectionRange.start.line).toBe(8)
  })

  it("returns no symbols when there is no Open Questions section", () => {
    expect(questionSymbols("# Plan\n\nJust prose.\n")).toEqual([])
  })
})

describe("reviewSymbols", () => {
  it("maps each chunk to a symbol with its checked/total count and one child per hunk", () => {
    const symbols = reviewSymbols(reviewDoc)
    expect(symbols.map((s) => s.name)).toEqual(["Add calculator (1/2)", "Wire it up (0/1)"])
    expect(symbols[0]?.children?.map((c) => c.name)).toEqual([
      "[ ] ./src/calc.ts#1",
      "[x] ./src/calc.ts#5 — subtract",
    ])
    expect(symbols[0]?.selectionRange.start.line).toBe(3)
    expect(symbols[0]?.children?.[0]?.selectionRange.start.line).toBe(5)
  })
})

describe("toggleHunkEdit", () => {
  it("flips an unchecked box to checked without touching the rest of the line", () => {
    const lines = reviewDoc.split("\n")
    const edit = toggleHunkEdit(reviewDoc, 5)
    expect(edit).toBeDefined()
    expect(lines[5]?.slice(edit!.range.start.character, edit!.range.end.character)).toBe(" ")
    expect(edit!.newText).toBe("x")
  })

  it("flips a checked box back to unchecked, preserving the trailing note", () => {
    const edit = toggleHunkEdit(reviewDoc, 6)
    expect(edit).toBeDefined()
    expect(edit!.newText).toBe(" ")
    const lines = reviewDoc.split("\n")
    const line = lines[6]!
    const patched =
      line.slice(0, edit!.range.start.character) +
      edit!.newText +
      line.slice(edit!.range.end.character)
    expect(patched).toBe("- [ ] ./src/calc.ts#5 — subtract")
  })

  it("returns undefined for a line that isn't a file pointer", () => {
    expect(toggleHunkEdit(reviewDoc, 3)).toBeUndefined()
  })
})

describe("toggleChunkEdits", () => {
  it("checks every remaining hunk when the chunk is majority-unchecked", () => {
    const edits = toggleChunkEdits(reviewDoc, 3)
    expect(edits).toHaveLength(1)
    expect(edits[0]?.newText).toBe("x")
  })

  it("unchecks every hunk when the chunk is already all-checked", () => {
    const allChecked = reviewDoc.replace("- [ ] ./src/calc.ts#1", "- [x] ./src/calc.ts#1")
    const edits = toggleChunkEdits(allChecked, 3)
    expect(edits).toHaveLength(2)
    expect(edits.every((e) => e.newText === " ")).toBe(true)
  })

  it("returns no edits for a heading that isn't a chunk", () => {
    expect(toggleChunkEdits(reviewDoc, 0)).toEqual([])
  })
})

describe("reviewCodeActions", () => {
  const uri = "file:///repo/.gtd/REVIEW.md"

  it("offers a single-hunk toggle when the range sits on a hunk line", () => {
    const actions = reviewCodeActions(uri, reviewDoc, {
      start: { line: 5, character: 0 },
      end: { line: 5, character: 0 },
    })
    expect(actions.map((a) => a.title)).toContain("gtd: check this hunk")
  })

  it("offers a whole-chunk toggle when the range sits on the chunk heading", () => {
    const actions = reviewCodeActions(uri, reviewDoc, {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 0 },
    })
    expect(actions.map((a) => a.title)).toContain('gtd: check all hunks in "Add calculator"')
  })

  it("scopes edits to the requested document uri", () => {
    const actions = reviewCodeActions(uri, reviewDoc, {
      start: { line: 5, character: 0 },
      end: { line: 5, character: 0 },
    })
    expect(actions[0]?.edit?.changes?.[uri]).toBeDefined()
  })
})

describe("STATE_FILE", () => {
  it("maps every review-related state to .gtd/REVIEW.md", () => {
    expect(STATE_FILE["review"]).toBe(".gtd/REVIEW.md")
    expect(STATE_FILE["await-review"]).toBe(".gtd/REVIEW.md")
  })

  it("omits work-package and no-file states, leaving the caller to fall back", () => {
    expect(STATE_FILE["building"]).toBeUndefined()
    expect(STATE_FILE["idle"]).toBeUndefined()
  })
})

describe("currentSteeringFile", () => {
  const runWith = (repo: InMemRepo) =>
    Effect.runPromise(currentSteeringFile.pipe(Effect.provide(inMemoryLayers(repo))))

  it("resolves to REVIEW.md while resting at await-review", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc", 'testCommand: "true"\n')
    repo.writeFile("readme.txt", "hello")
    repo.commitAllWithPrefix("init: first commit")
    repo.writeFile("src/code.ts", "export const x = 1")
    repo.commitAllWithPrefix("gtd(agent): building")
    repo.writeFile(
      ".gtd/REVIEW.md",
      "# Review: abc1234\n\n<!-- base: abc1234 -->\n\n## Chunk\n\n- [ ] ./src/code.ts#1\n",
    )
    repo.commitAllWithPrefix("gtd(agent): review")
    repo.commitAllWithPrefix("gtd: await-review")

    const outcome = await runWith(repo)
    expect(outcome).toEqual({ kind: "file", uri: expect.stringContaining("REVIEW.md") })
  })

  it("reports the state when it has no single mapped file", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc", 'testCommand: "true"\n')
    repo.writeFile("readme.txt", "hello")
    repo.commitAllWithPrefix("init: first commit")

    const outcome = await runWith(repo)
    expect(outcome).toEqual({ kind: "none", state: "idle" })
  })
})
