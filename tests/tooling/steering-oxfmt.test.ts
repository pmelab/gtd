import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  applySteeringEdits,
  BUILT_IN_MODE_NAMES,
  parseFootnotes,
  parseThreads,
  steeringFormatFor,
  type SteeringFormat,
  type SteeringViewNode,
} from "../../src/steering/index.js"

// Steering files are committed under the repo's own formatter: these pin that
// oxfmt's markdown output stays readable by every steering format.

const QA_FORMAT = steeringFormatFor("qa")!
const REVIEW_FORMAT = steeringFormatFor("review")!

/**
 * Formats `content` with the repo's real `oxfmt` binary, under the repo's
 * own `.oxfmtrc.json` (`*.md` override: printWidth 80, proseWrap always) —
 * measured behaviour, not assumed. Each call gets its own scratch directory
 * so parallel tests never share a file.
 */
const formatWithOxfmt = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-footnote-oxfmt-"))
  try {
    writeFileSync(join(dir, ".oxfmtrc.json"), readFileSync(join(process.cwd(), ".oxfmtrc.json")))
    const file = join(dir, "sample.md")
    writeFileSync(file, content)
    execFileSync(join(process.cwd(), "node_modules", ".bin", "oxfmt"), ["--write", file], {
      cwd: dir,
    })
    return readFileSync(file, "utf8")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const nodesOf = (nodes: readonly SteeringViewNode[]): readonly SteeringViewNode[] =>
  nodes.flatMap((n) => [n, ...nodesOf(n.children ?? []), ...nodesOf(n.body ?? [])])

/** `content` with `text` attached at the first anchor `annotate` accepts. */
const attachAtFirstAnchor = (format: SteeringFormat, content: string, text: string): string => {
  for (const { anchor } of nodesOf(format.view(content).nodes)) {
    const result = format.annotate(content, anchor, text)
    if (result.ok) return applySteeringEdits(content, result.edits)
  }
  throw new Error("no anchor accepts a note")
}

describe("footnote formatter round-trip (real oxfmt, measured not assumed)", () => {
  it("both samples carry a footnote whose body exceeds 80 characters", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      const { definitions } = parseFootnotes(format.sample)
      expect(definitions.length).toBeGreaterThan(0)
      expect(definitions.some((d) => d.body.length > 80)).toBe(true)
    }
  })

  it("both samples are already oxfmt fixed points, and still validate clean after formatting", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      const formatted = formatWithOxfmt(format.sample)
      expect(formatted).toBe(format.sample)
      expect(format.validate(formatted)).toEqual([])
    }
  })

  it("a definition under 80 characters stays on one line, byte for byte", () => {
    const content = "text[^fn1]\n\n[^fn1]: a short reason\n"
    expect(formatWithOxfmt(content)).toBe(content)
  })

  it("a definition over 80 characters becomes '[^name]:' alone, wrapped body indented four spaces", () => {
    const longBody =
      "This option keeps the current behavior exactly as it is today, which is the safer default for most reviewers."
    const content = `text[^fn1]\n\n[^fn1]: ${longBody}\n`
    const formatted = formatWithOxfmt(content)
    expect(formatted).toBe(
      [
        "text[^fn1]",
        "",
        "[^fn1]:",
        "    This option keeps the current behavior exactly as it is today, which is the",
        "    safer default for most reviewers.",
        "",
      ].join("\n"),
    )
    const { definitions } = parseFootnotes(formatted)
    expect(definitions[0]!.body).toBe(
      "This option keeps the current behavior exactly as it is today, which is the safer default for most reviewers.",
    )
  })

  it("a marker inside a checkbox row is never moved or rewritten", () => {
    const content = "- [ ] Option A[^fn1]\n- [ ] Option B\n\n[^fn1]: reason\n"
    expect(formatWithOxfmt(content)).toContain("- [ ] Option A[^fn1]")
  })

  it("a marker inside a paragraph is never moved or rewritten", () => {
    const content = "A claim in prose[^fn1] continues here.\n\n[^fn1]: reason\n"
    expect(formatWithOxfmt(content)).toContain("A claim in prose[^fn1] continues here.")
  })

  it("a definition between two hunk pointers stays exactly where it was written", () => {
    const content = [
      "- [ ] ./a.ts#1",
      "first",
      "",
      "[^fn1]: between the two hunks",
      "",
      "- [ ] ./b.ts#2",
      "second",
      "",
    ].join("\n")
    const formatted = formatWithOxfmt(content)
    const lines = formatted.split("\n")
    const defIndex = lines.findIndex((l) => l.startsWith("[^fn1]:"))
    const firstPointer = lines.findIndex((l) => l.includes("./a.ts#1"))
    const secondPointer = lines.findIndex((l) => l.includes("./b.ts#2"))
    expect(defIndex).toBeGreaterThan(firstPointer)
    expect(defIndex).toBeLessThan(secondPointer)
  })

  it("an empty body ([^name]:) survives untouched", () => {
    const content = "text[^fn1]\n\n[^fn1]:\n"
    expect(formatWithOxfmt(content)).toBe(content)
  })
})

describe("'gtd: add a footnote' produces an oxfmt fixed point in both formats", () => {
  it("qa: applying the action's edits to the sample validates clean apart from the empty-body finding, and is an oxfmt fixed point", () => {
    const cursor = { line: 8, character: 8 } // inside "Option B"
    const action = QA_FORMAT.actions(QA_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )!
    const applied = applySteeringEdits(QA_FORMAT.sample, action.edits)
    const findings = QA_FORMAT.validate(applied).map((f) => f.message)
    expect(findings.every((m) => m.includes("has an empty body"))).toBe(true)
    expect(findings.length).toBeGreaterThan(0)
    expect(formatWithOxfmt(applied)).toBe(applied)
  })

  it("review: applying the action's edits to the sample validates clean apart from the empty-body finding, and is an oxfmt fixed point", () => {
    const cursor = { line: 6, character: 20 } // inside "what" on the hunk pointer line
    const action = REVIEW_FORMAT.actions(REVIEW_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )!
    const applied = applySteeringEdits(REVIEW_FORMAT.sample, action.edits)
    const findings = REVIEW_FORMAT.validate(applied).map((f) => f.message)
    expect(findings.every((m) => m.includes("has an empty body"))).toBe(true)
    expect(findings.length).toBeGreaterThan(0)
    expect(formatWithOxfmt(applied)).toBe(applied)
  })

  it("qa: a cursor inside the LAST word of the block's last line does not corrupt the marker (regression: the two edits used to share a start position)", () => {
    // Derived from the sample, never a hardcoded line: the sample grew a
    // second (server-attached) footnote, which moved this line once already.
    const lastOptionLine = QA_FORMAT.sample
      .split("\n")
      .findIndex((l) => l.includes("_your answer_"))
    const cursor = { line: lastOptionLine, character: "- [ ] _your answer_".length } // end of "_your answer_", the last option — blockEndLine itself
    const action = QA_FORMAT.actions(QA_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )!
    const applied = applySteeringEdits(QA_FORMAT.sample, action.edits)
    expect(applied).toContain("_your answer_[^fn2]")
    const findings = QA_FORMAT.validate(applied).map((f) => f.message)
    expect(findings.every((m) => m.includes("has an empty body"))).toBe(true)
    expect(findings.length).toBeGreaterThan(0)
    expect(formatWithOxfmt(applied)).toBe(applied)
  })

  it("review: a cursor at end-of-line on the hunk's own last line does not corrupt the marker (regression, same shape as the qa case)", () => {
    const content = [
      "# Review: abc1234",
      "",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Chunk",
      "",
      "- [ ] ./src/a.ts#1-1 some trailing prose",
      "",
    ].join("\n")
    // The fixture itself must already be an oxfmt fixed point, or the
    // assertion below would fail on unrelated reflow, not the regression
    // this test targets.
    expect(formatWithOxfmt(content)).toBe(content)
    const cursor = { line: 6, character: "- [ ] ./src/a.ts#1-1 some trailing prose".length } // end of blockEndLine
    const action = REVIEW_FORMAT.actions(content, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )!
    const applied = applySteeringEdits(content, action.edits)
    expect(applied).toContain("some trailing prose[^fn1]")
    const findings = REVIEW_FORMAT.validate(applied).map((f) => f.message)
    expect(findings.every((m) => m.includes("has an empty body"))).toBe(true)
    expect(findings.length).toBeGreaterThan(0)
    expect(formatWithOxfmt(applied)).toBe(applied)
  })
})

describe("a server-written note reflows under oxfmt and still validates", () => {
  // One long unwrapped line, the shape `annotate` writes: the sample's notes
  // are already wrapped, so only a fresh note exercises oxfmt's reflow.
  const LONG_UNWRAPPED_NOTE =
    "Attached by a human through the phone UI, this note is intentionally " +
    "written as one long unwrapped line so the formatter actually has " +
    "something to reflow, and it carries a `multi word code span` too."

  /** The line span of the note carrying `LONG_UNWRAPPED_NOTE` — a thread's entry (a fresh `qa` note) or a one-shot footnote body (a note replacing the review sample's). */
  const noteSpan = (content: string): { line: number; endLine: number } | undefined => {
    const entry = parseThreads(content)
      .flatMap((t) => t.entries)
      .find((e) => e.text === LONG_UNWRAPPED_NOTE)
    if (entry) return entry
    return parseFootnotes(content).definitions.find((d) => d.body === LONG_UNWRAPPED_NOTE)
  }

  it("reflows a freshly-attached note across multiple lines, and still validates clean afterward", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      const applied = attachAtFirstAnchor(format, format.sample, LONG_UNWRAPPED_NOTE)

      // Before formatting: the note is genuinely ONE physical line —
      // proof this test feeds the formatter an actually-unwrapped note.
      const before = noteSpan(applied)!
      expect(before.endLine).toBe(before.line)

      const formatted = formatWithOxfmt(applied)

      // After formatting: oxfmt actually reflowed it across multiple lines.
      const after = noteSpan(formatted)!
      expect(after.endLine).toBeGreaterThan(after.line)

      expect(format.validate(formatted)).toEqual([])
    }
  })

  it("a note containing a multi-word inline code span still validates after reflow", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      expect(LONG_UNWRAPPED_NOTE).toMatch(/`[^`]*\s[^`]*`/)
      const applied = attachAtFirstAnchor(format, format.sample, LONG_UNWRAPPED_NOTE)
      const formatted = formatWithOxfmt(applied)
      expect(formatted).toContain("`multi word code span`")
      expect(format.validate(formatted)).toEqual([])
    }
  })
})
