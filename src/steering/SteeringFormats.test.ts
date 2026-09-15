import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { builtInModeNames, steeringFormatFor } from "./index.js"
import { parseFootnotes } from "./Footnotes.js"

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

describe("builtInModeNames", () => {
  it("lists the two built-in format names", () => {
    expect(builtInModeNames()).toEqual(["qa", "review"])
  })
})

describe("steeringFormatFor", () => {
  it("resolves 'qa' and 'review' to their singleton formats", () => {
    expect(steeringFormatFor("qa")).toBe(QA_FORMAT)
    expect(steeringFormatFor("review")).toBe(REVIEW_FORMAT)
  })

  it("resolves an unknown name to undefined", () => {
    expect(steeringFormatFor("prose")).toBeUndefined()
    expect(steeringFormatFor("adr")).toBeUndefined()
  })
})

describe("every registry entry's sample", () => {
  // Load-bearing, not a nicety (see the package's own doc comment on this
  // acceptance criterion): `src/ModeContradiction.ts` round-trips this exact
  // sample through a mode's declared `format:` command, then re-validates it
  // — a sample that doesn't validate clean to begin with would hard-stop
  // every prompt beat that declares `file:`+`mode:`, at 3 wasted agent turns
  // each, with no way to tell a real contradiction from a drifted fixture.
  it("validates clean under its own format's parser", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      expect(format.validate(format.sample)).toEqual([])
    }
  })
})

describe("every registry entry declares apply", () => {
  it("has a function-typed apply member, not just annotate", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      expect(typeof format.apply).toBe("function")
    }
  })
})

/** Every `SteeringAnchor` embedded anywhere in `view` — walks whatever shape `view` returns without switching on `kind`, mirroring the server's own "never switch on the mode name" discipline. */
const anchorsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(anchorsIn)
  if (value === null || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const found: unknown[] = []
  for (const [key, val] of Object.entries(record)) {
    if (key === "anchor") found.push(val)
    else found.push(...anchorsIn(val))
  }
  return found
}

describe("every registry entry's view", () => {
  it("parses `format.sample` without throwing", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      expect(() => format.view(format.sample)).not.toThrow()
    }
  })

  // `format.sample` itself, derived from the registry entry alone — never a
  // per-mode fixture table (a third registry entry with no matching key
  // there would fail on a confusing `undefined`, not on the property under
  // test). `format.sample` already carries a note attached at ONE of its own
  // anchors (T7 requires a server-written note in the sample) — annotating
  // that SAME anchor again now EDITS the existing note in place
  // (`Footnotes.ts#footnoteAttachEdits`'s same-anchor update path, T6: "offers
  // editing it, not a second note"), which this treats as a PASS (`ok: true`)
  // same as any other anchor; a genuine `id-collision` (an unrelated anchor's
  // derived id colliding with existing content) remains an acceptable refusal
  // too. Only `anchor-not-found` — the anchor itself failing to resolve — is
  // the failure this property actually guards against.
  it("every anchor `view` reports is one `annotate` accepts (or correctly refuses only as an id-collision, never as anchor-not-found)", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      const content = format.sample
      const view = format.view(content)
      const anchors = anchorsIn(view)
      expect(anchors.length).toBeGreaterThan(0)
      for (const anchor of anchors) {
        const result = format.annotate(content, anchor as never, "a note a human typed")
        const acceptable = result.ok || (!result.ok && result.reason === "id-collision")
        expect(
          acceptable,
          `${mode}: ${JSON.stringify(anchor)} was refused: ${JSON.stringify(result)}`,
        ).toBe(true)
      }
    }
  })
})

describe("footnote formatter round-trip (real oxfmt, measured not assumed)", () => {
  it("both samples carry a footnote whose body exceeds 80 characters", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      const { definitions } = parseFootnotes(format.sample)
      expect(definitions.length).toBeGreaterThan(0)
      expect(definitions.some((d) => d.body.length > 80)).toBe(true)
    }
  })

  it("both samples are already oxfmt fixed points, and still validate clean after formatting", () => {
    for (const mode of builtInModeNames()) {
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

/**
 * Applies a set of `SteeringEdit`s (LSP-shaped `TextEdit`s) to `content` —
 * every position converted to a flat offset assuming `\n` line separators
 * (fixture content only), edits applied back-to-front so earlier ranges'
 * offsets stay valid.
 */
const applyEdits = (
  content: string,
  edits: readonly {
    readonly range: {
      readonly start: { readonly line: number; readonly character: number }
      readonly end: { readonly line: number; readonly character: number }
    }
    readonly newText: string
  }[],
): string => {
  const lines = content.split("\n")
  const offsetOf = (pos: { readonly line: number; readonly character: number }): number => {
    let offset = 0
    for (let i = 0; i < pos.line; i += 1) offset += lines[i]!.length + 1
    return offset + pos.character
  }
  const sorted = [...edits].sort((a, b) => offsetOf(b.range.start) - offsetOf(a.range.start))
  let result = content
  for (const edit of sorted) {
    result =
      result.slice(0, offsetOf(edit.range.start)) +
      edit.newText +
      result.slice(offsetOf(edit.range.end))
  }
  return result
}

describe("'gtd: add a footnote' produces an oxfmt fixed point in both formats", () => {
  it("qa: applying the action's edits to the sample validates clean apart from the placeholder finding, and is an oxfmt fixed point", () => {
    const cursor = { line: 7, character: 8 } // inside "Option B"
    const action = QA_FORMAT.actions(QA_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )!
    const applied = applyEdits(QA_FORMAT.sample, action.edits)
    const findings = QA_FORMAT.validate(applied).map((f) => f.message)
    expect(findings.every((m) => m.includes("still has its seeded placeholder body"))).toBe(true)
    expect(findings.length).toBeGreaterThan(0)
    expect(formatWithOxfmt(applied)).toBe(applied)
  })

  it("review: applying the action's edits to the sample validates clean apart from the placeholder finding, and is an oxfmt fixed point", () => {
    const cursor = { line: 6, character: 20 } // inside "what" on the hunk pointer line
    const action = REVIEW_FORMAT.actions(REVIEW_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )!
    const applied = applyEdits(REVIEW_FORMAT.sample, action.edits)
    const findings = REVIEW_FORMAT.validate(applied).map((f) => f.message)
    expect(findings.every((m) => m.includes("still has its seeded placeholder body"))).toBe(true)
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
    const applied = applyEdits(QA_FORMAT.sample, action.edits)
    expect(applied).toContain("_your answer_[^fn2]")
    const findings = QA_FORMAT.validate(applied).map((f) => f.message)
    expect(findings.every((m) => m.includes("still has its seeded placeholder body"))).toBe(true)
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
      "- [ ] ./src/a.ts#1 some trailing prose",
      "",
    ].join("\n")
    // The fixture itself must already be an oxfmt fixed point, or the
    // assertion below would fail on unrelated reflow, not the regression
    // this test targets.
    expect(formatWithOxfmt(content)).toBe(content)
    const cursor = { line: 6, character: "- [ ] ./src/a.ts#1 some trailing prose".length } // end of blockEndLine
    const action = REVIEW_FORMAT.actions(content, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )!
    const applied = applyEdits(content, action.edits)
    expect(applied).toContain("some trailing prose[^fn1]")
    const findings = REVIEW_FORMAT.validate(applied).map((f) => f.message)
    expect(findings.every((m) => m.includes("still has its seeded placeholder body"))).toBe(true)
    expect(findings.length).toBeGreaterThan(0)
    expect(formatWithOxfmt(applied)).toBe(applied)
  })

  it("qa: refuses the action with the cursor inside an existing marker's [^name] span, rather than nesting a new marker into it", () => {
    const cursor = { line: 6, character: 19 } // "- [ ] Option A[^fn1]" — between the name and its "]"
    const action = QA_FORMAT.actions(QA_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )
    expect(action).toBeUndefined()
  })

  it("qa: refuses the action with the cursor on an existing definition's own label line, rather than splitting it", () => {
    const cursor = { line: 10, character: 6 } // "[^fn1]:" — the definition's own label line
    const action = QA_FORMAT.actions(QA_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )
    expect(action).toBeUndefined()
  })
})
