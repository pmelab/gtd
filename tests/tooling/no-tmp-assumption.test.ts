import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

// gtd assumes nothing about where the OS keeps scratch files: every git
// subprocess it spawns already inherits `$TMPDIR`/`$GIT_DIR`/`$GIT_WORK_TREE`
// from the ambient environment, so `src/` itself must never hard-code `/tmp`
// or shell out to `mktemp` — either one would silently divert from wherever
// the caller actually pointed those variables. `*.test.ts` files are IN
// scope: a test fixture that hard-codes "/tmp/..." makes the same assumption
// a production path would, even though it's never written to disk (a
// portable stand-in reads just as well). Legitimate real-git test setup
// (`mkdtempSync(join(tmpdir(), ...))`, node:os's `tmpdir()`) is unaffected —
// neither the literal string "/tmp" nor the word "mktemp" appears in that
// pattern.
const SRC_DIR = resolve(import.meta.dirname, "../../src")

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

const tsFiles = readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort()

describe("src/ never assumes a literal /tmp path or calls mktemp, outside comments", () => {
  it("scans every .ts file under src/", () => {
    expect(tsFiles.length).toBeGreaterThan(0)

    const violations: string[] = []
    for (const file of tsFiles) {
      const code = stripComments(readFileSync(file, "utf8"))
      const name = relative(SRC_DIR, file)
      if (code.includes("/tmp")) violations.push(`${name}: contains a "/tmp" literal`)
      if (/\bmktemp\b/.test(code)) violations.push(`${name}: calls mktemp`)
    }

    expect(
      violations,
      "src/ must not assume a fixed temp-file location — resolve it via node:os's tmpdir() " +
        "(which already honors $TMPDIR) or the ambient $GIT_DIR/$GIT_WORK_TREE instead",
    ).toEqual([])
  })
})
