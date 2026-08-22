import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

// gtd is non-interactive today: no readline, no /dev/tty, no prompt call
// anywhere in src/ (see .gtd/packages/11-interaction-and-colour.md). If
// interaction is ever added it must go to /dev/tty, never stderr — mixing a
// question into stderr's existing narration/remediation traffic would
// deadlock a driver that never reads it. This test guards that: any of the
// violations below must be a deliberate, reviewed decision, not an
// accidental import.
//
// The bare word "prompt" is deliberately NOT matched — it's gtd's own domain
// vocabulary for a content kind (`prompt:` config keys, `PromptContent`
// types) and appears throughout src/ with no interactive meaning at all.
const SRC_DIR = resolve(import.meta.dirname, "../../src")

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

const tsFiles = readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort()

const PROMPT_LIBRARIES = ["inquirer", "enquirer", "prompts", "readline-sync"]

describe("src/ never imports readline, references /dev/tty, or calls an interactive prompt facility", () => {
  it("scans every .ts file under src/", () => {
    expect(tsFiles.length).toBeGreaterThan(0)

    const violations: string[] = []
    for (const file of tsFiles) {
      const code = stripComments(readFileSync(file, "utf8"))
      const name = relative(SRC_DIR, file)

      if (/\breadline\b/.test(code)) violations.push(`${name}: references readline`)
      if (code.includes("/dev/tty")) violations.push(`${name}: contains a "/dev/tty" literal`)
      if (code.includes(".question(")) violations.push(`${name}: calls .question(`)
      if (code.includes(".createInterface(")) violations.push(`${name}: calls .createInterface(`)
      for (const lib of PROMPT_LIBRARIES) {
        if (new RegExp(`from\\s+["']${lib}["']|require\\(["']${lib}["']\\)`).test(code)) {
          violations.push(`${name}: imports prompt library "${lib}"`)
        }
      }
    }

    expect(
      violations,
      "gtd is non-interactive: src/ must never import readline, reference /dev/tty, or call an " +
        "interactive prompt facility (readline's own API, or a prompt library like inquirer/" +
        "enquirer/prompts/readline-sync) — see .gtd/packages/11-interaction-and-colour.md",
    ).toEqual([])
  })
})
