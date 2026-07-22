import { describe, expect, it } from "vitest"
import {
  questionSymbols,
  questionDiagnostics,
  reviewSymbols,
  reviewDiagnostics,
  toggleHunkEdit,
  toggleChunkEdits,
  reviewCodeActions,
  basenameFallbackMode,
  buildFileModeMap,
  modeForDocument,
  resolveWorkspaceRoot,
  steeringFileOutcome,
} from "./Lsp.js"
import type { WorkflowDefinition } from "./PatternMachine.js"

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

describe("questionDiagnostics", () => {
  it("returns no diagnostics for a well-formed document", () => {
    expect(questionDiagnostics(questionsDoc)).toEqual([])
  })

  it("publishes one diagnostic per malformed question, matching parseOpenQuestions's own errors", () => {
    const malformed = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "Not sure yet.",
      "",
    ].join("\n")
    const diagnostics = questionDiagnostics(malformed)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toBe(
      'Open question "Which operations?" is missing a "Suggested default: ..." or "Answer: ..." line',
    )
    expect(diagnostics[0]?.source).toBe("gtd")
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

describe("reviewDiagnostics", () => {
  it("returns no diagnostics for a well-formed document", () => {
    expect(reviewDiagnostics(reviewDoc)).toEqual([])
  })

  it("publishes one diagnostic per structural error, matching parseReviewDoc's own errors", () => {
    const malformed = "Just some text\n"
    const diagnostics = reviewDiagnostics(malformed)
    expect(diagnostics.map((d) => d.message)).toEqual([
      "Missing or malformed '# Review: <hash>' header as the document's first line",
      "Missing '<!-- base: <hash> -->' comment",
      "REVIEW.md has no '##' chunks",
    ])
    expect(diagnostics.every((d) => d.source === "gtd")).toBe(true)
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

describe("basenameFallbackMode", () => {
  it("maps TODO.md to qa and REVIEW.md to review, and anything else to undefined", () => {
    expect(basenameFallbackMode("TODO.md")).toBe("qa")
    expect(basenameFallbackMode("REVIEW.md")).toBe("review")
    expect(basenameFallbackMode("NOTES.md")).toBeUndefined()
  })
})

describe("buildFileModeMap", () => {
  const def = (states: WorkflowDefinition["states"]): WorkflowDefinition => ({ states })

  it("renders each state's `file:` (vars-layer context) into an absolute path keyed to its `mode`", () => {
    const { map, warnings } = buildFileModeMap(
      def({
        grilling: {
          actor: "agent",
          prompt: "x",
          file: "<%= it.vars.todoFile %>",
          mode: "qa",
          initial: true,
        },
        reviewing: {
          actor: "agent",
          prompt: "x",
          file: "<%= it.vars.reviewFile %>",
          mode: "review",
        },
        idle: { actor: "human", message: "x" },
      }),
      { todoFile: ".gtd/TODO.md", reviewFile: ".gtd/REVIEW.md" },
      "/repo",
    )
    expect(warnings).toEqual([])
    expect(map.get("/repo/.gtd/TODO.md")).toBe("qa")
    expect(map.get("/repo/.gtd/REVIEW.md")).toBe("review")
    expect(map.size).toBe(2)
  })

  it("skips a state whose `file:` fails to render and warns, without failing the whole map", () => {
    const { map, warnings } = buildFileModeMap(
      def({
        broken: { actor: "agent", prompt: "x", file: "<%= it.vars.nope.deeper %>", mode: "qa" },
        ok: { actor: "agent", prompt: "x", file: "PLAN.md", mode: "qa" },
      }),
      {},
      "/repo",
    )
    expect(map.get("/repo/PLAN.md")).toBe("qa")
    expect(map.size).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('state "broken"')
  })

  it("keeps the FIRST declaring state's mode on a path conflict, warning about the later one", () => {
    const { map, warnings } = buildFileModeMap(
      def({
        first: { actor: "agent", prompt: "x", file: "SHARED.md", mode: "qa" },
        second: { actor: "agent", prompt: "x", file: "SHARED.md", mode: "review" },
      }),
      {},
      "/repo",
    )
    expect(map.get("/repo/SHARED.md")).toBe("qa")
    expect(map.size).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('state "second"')
  })

  it("ignores a state declaring neither `file:` nor `mode:`", () => {
    const { map, warnings } = buildFileModeMap(
      def({ idle: { actor: "human", message: "x", initial: true } }),
      {},
      "/repo",
    )
    expect(map.size).toBe(0)
    expect(warnings).toEqual([])
  })
})

describe("modeForDocument", () => {
  it("prefers the config-driven map over the basename fallback", () => {
    const map = new Map([["/repo/PLAN.md", "qa" as const]])
    expect(modeForDocument("file:///repo/PLAN.md", map)).toBe("qa")
  })

  it("falls back to basename dispatch for a path the map doesn't cover", () => {
    const map = new Map()
    expect(modeForDocument("file:///repo/.gtd/TODO.md", map)).toBe("qa")
    expect(modeForDocument("file:///repo/.gtd/REVIEW.md", map)).toBe("review")
    expect(modeForDocument("file:///repo/NOTES.md", map)).toBeUndefined()
  })
})

describe("resolveWorkspaceRoot", () => {
  it("prefers the first workspaceFolders entry", () => {
    expect(
      resolveWorkspaceRoot({
        workspaceFolders: [{ uri: "file:///repo" }, { uri: "file:///other" }],
        rootUri: "file:///deprecated",
      }),
    ).toBe("/repo")
  })

  it("falls back to the deprecated rootUri when workspaceFolders is absent", () => {
    expect(resolveWorkspaceRoot({ rootUri: "file:///repo" })).toBe("/repo")
  })

  it("is undefined when neither is present", () => {
    expect(resolveWorkspaceRoot({})).toBeUndefined()
    expect(resolveWorkspaceRoot({ workspaceFolders: null, rootUri: null })).toBeUndefined()
  })
})

describe("steeringFileOutcome", () => {
  it("resolves a declared `file:` to a `file://` URI under root", () => {
    const outcome = steeringFileOutcome("grilling", ".gtd/TODO.md", "/repo")
    expect(outcome).toEqual({ kind: "show", uri: "file:///repo/.gtd/TODO.md" })
  })

  it("informs, naming the state, when no `file:` is declared", () => {
    const outcome = steeringFileOutcome("idle", undefined, "/repo")
    expect(outcome).toEqual({ kind: "inform", state: "idle" })
  })
})
