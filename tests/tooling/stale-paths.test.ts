import { existsSync, readFileSync, readdirSync } from "node:fs"
import { extname, join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

// AGENTS.md: a comment naming a file is a load-bearing claim, not decoration
// — it must stay checkable. This walks every file under src/ and tests/ and
// asserts every repo-path-shaped reference it finds resolves on disk.
// `gtd-path-exempt` on the same line is the one escape hatch — no file- or
// pattern-level skip exists — for a reference that is deliberately
// illustrative (a glob example, a scenario fixture) rather than a real claim.
//
// Two extraction passes, over every scanned file:
//   1. BACKTICK_PATH_RE — any backtick-quoted `src/…`/`tests/…`/etc path,
//      wherever it appears (comment or code).
//   2. BARE_PATH_RE — an un-backticked path, but ONLY inside prose that reads
//      as a documentary claim: a `.ts` file's `//`/`/* */` comments, or a
//      `.feature` file's text outside `"…"` step strings and `"""` docstring
//      blocks (both of those are fixture DATA, not a claim about the repo —
//      a `Given a file "…" with:` step names a file the scenario is about to
//      CREATE, not one that must already exist).
// Every other extension (`.sh`, `.yaml`, `.py`, `.html`) gets pass 1 only —
// bare prose there is NOT scanned. That is a real gap, accepted because those
// files are a small fraction of the tree and mostly script/data content, not
// hand-written claims about other files.
const REPO_ROOT = resolve(import.meta.dirname, "../..")
const EXEMPT_TOKEN = "gtd-path-exempt"

const REPO_PATH_BODY = `(?:src|tests|docs|scripts|dev|evals)/[A-Za-z0-9_./-]+\\.(?:ts|tsx|js|jsx|mjs|cjs|json|feature|md)(?::\\d+(?:-\\d+)?)?`
const BACKTICK_PATH_RE = new RegExp("`(" + REPO_PATH_BODY + ")`", "g")
// Excludes a match immediately touching a backtick (already covered by pass 1) or another path/word character (so it anchors on a whole token).
const BARE_PATH_RE = new RegExp("(?<![`\\w./-])(" + REPO_PATH_BODY + ")(?![`\\w])", "g")

const scanDirs = ["src", "tests"]

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))

const allFiles = scanDirs.flatMap((dir) => listFiles(resolve(REPO_ROOT, dir))).sort()

/** Same length as `s`, every character blanked to a space except newlines — keeps line/column numbering aligned with the original. */
const blank = (s: string): string => s.replace(/[^\n]/g, " ")

// Tokenizes every `//`/`/* */` comment and every `"…"`/`'…'`/`` `…` `` string
// (with backslash-escape awareness) in one pass, via named groups so the
// caller can tell which alternative matched without re-deriving it.
const COMMENT_OR_STRING_RE =
  /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g

/** Masks everything except `//` line comments and `/* *‍/` block comments — code goes blank, and so does every string/template literal FIRST (a fixture literal like `"M src/*.ts"` contains a bare `/*`, which would otherwise be misread as a block comment opening and swallow real code after it). */
const maskToComments = (content: string): string => {
  let masked = ""
  let last = 0
  for (const match of content.matchAll(COMMENT_OR_STRING_RE)) {
    masked += blank(content.slice(last, match.index))
    masked += match.groups?.comment !== undefined ? match[0] : blank(match[0])
    last = match.index + match[0].length
  }
  masked += blank(content.slice(last))
  return masked
}

/** Masks every `"""…"""` docstring block and every `"…"` string on a line — Gherkin fixture data — leaving step keywords, `#` comments, and free narrative prose intact. */
const maskFeatureFixtures = (content: string): string => {
  const noDocstrings = content.replace(/"""[\s\S]*?"""/g, blank)
  return noDocstrings.replace(/"[^"\n]*"/g, blank)
}

interface Extracted {
  readonly file: string
  readonly line: number
  readonly path: string
  readonly exempt: boolean
}

const extractFromText = (
  file: string,
  originalLines: readonly string[],
  scanText: string,
  re: RegExp,
): Extracted[] => {
  const found: Extracted[] = []
  const scanLines = scanText.split("\n")
  scanLines.forEach((lineText, index) => {
    for (const match of lineText.matchAll(re)) {
      found.push({
        file,
        line: index + 1,
        path: match[1]!,
        exempt: (originalLines[index] ?? "").includes(EXEMPT_TOKEN),
      })
    }
  })
  return found
}

const extractAll = (): readonly Extracted[] => {
  const found: Extracted[] = []
  for (const file of allFiles) {
    const content = readFileSync(file, "utf8")
    const lines = content.split("\n")
    const rel = relative(REPO_ROOT, file)
    found.push(...extractFromText(rel, lines, content, BACKTICK_PATH_RE))

    const ext = extname(file)
    if (ext === ".ts" || ext === ".tsx") {
      found.push(...extractFromText(rel, lines, maskToComments(content), BARE_PATH_RE))
    } else if (ext === ".feature") {
      found.push(...extractFromText(rel, lines, maskFeatureFixtures(content), BARE_PATH_RE))
    }
  }
  return found
}

describe("every repo-path-shaped reference under src/ and tests/ resolves on disk", () => {
  it("scans at least one file", () => {
    expect(allFiles.length).toBeGreaterThan(0)
  })

  it("fails closed: an extracted path that doesn't exist and isn't exempt is a violation", () => {
    const extracted = extractAll()
    expect(extracted.length).toBeGreaterThan(0)

    // A citation like `src/Commentary.ts:39` carries a `:line`/`:line-line`
    // suffix that is never itself part of the filesystem path — strip it
    // before checking existence (the reported message keeps the full text).
    const pathOnly = (path: string): string => path.replace(/:\d+(-\d+)?$/, "")

    const violations = extracted.filter(
      (entry) => !entry.exempt && !existsSync(resolve(REPO_ROOT, pathOnly(entry.path))),
    )

    if (violations.length > 0) {
      // Distinct file:line pairs among the EXTRACTED paths that carry the
      // pragma — a lower bound on grep's raw count, which also matches the
      // token's own definition/prose inside this file (lines with no
      // extracted path at all, so not counted here).
      const exemptLineCount = new Set(
        extracted.filter((entry) => entry.exempt).map((entry) => `${entry.file}:${entry.line}`),
      ).size
      const detail = violations
        .map((v) => `${v.file}:${v.line}: \`${v.path}\` does not exist`)
        .join("\n")
      expect.fail(
        `${violations.length} stale path reference(s) (at least ${exemptLineCount} exempted ` +
          `line(s) pin real matches; run \`grep -rn ${EXEMPT_TOKEN} src tests\` for the full set):\n${detail}`,
      )
    }
  })
})
