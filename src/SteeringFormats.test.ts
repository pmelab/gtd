import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  builtInModeNames,
  isSeededValidateCommand,
  seededValidateCommand,
  steeringFormatFor,
} from "./SteeringFormats.js"
import { QA_FORMAT } from "./OpenQuestions.js"
import { REVIEW_FORMAT } from "./ReviewDoc.js"
import { parseFootnotes } from "./Footnotes.js"

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

describe("seededValidateCommand / isSeededValidateCommand", () => {
  it("recognizes its own seeded command for every built-in mode", () => {
    fc.assert(
      fc.property(fc.constantFrom(...builtInModeNames()), (mode) => {
        expect(isSeededValidateCommand(mode, seededValidateCommand(mode))).toBe(true)
      }),
    )
  })

  it("rejects a hand-written command", () => {
    expect(isSeededValidateCommand("qa", "npx prettier --check <%= it.file %>")).toBe(false)
  })

  it("rejects another mode's seeded command", () => {
    expect(isSeededValidateCommand("review", seededValidateCommand("qa"))).toBe(false)
  })

  it("rejects near-miss whitespace/quoting variants", () => {
    expect(isSeededValidateCommand("qa", "gtd check qa  '<%= it.file %>'")).toBe(false)
    expect(isSeededValidateCommand("qa", `gtd check qa "<%= it.file %>"`)).toBe(false)
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
