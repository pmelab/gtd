import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { renderStateTemplate, type TemplateContext } from "../PatternTemplates.js"
import { compileTemplate } from "./index.js"

const execFileAsync = promisify(execFile)

/**
 * Runs `qualityReview.seeding`/`qualityReview.picking` for real — same render
 * path `tests/tooling/shell-corpus.test.ts` and `scripts/generate-shell-corpus.ts`
 * use — rather than a hand-written fabrication of what the script would do.
 * `tests/integration/features/quality-review-lap.feature` stays `@inmem` and
 * covers gtd's ROUTING only; this covers the two scripts' own mechanics. Lives
 * beside `escalateScript.test.ts`/`reviewLapScripts.test.ts`/
 * `specReviewScripts.test.ts` — same shape, same `test-owns-impl` sibling
 * import of `renderStateTemplate`, no barrel export needed for it.
 */

const baseContext = (dir: string, qualityReviews: string): TemplateContext => {
  const { vars } = compileTemplate()
  return {
    startCommit: "",
    currentCommit: "",
    previousCommit: "",
    state: "build.quality.seeding",
    actor: "check",
    reviewBase: "",
    processBase: "",
    processCost: 0,
    processCostByModel: [],
    read: (path: string) => readFileSync(join(dir, path), "utf8"),
    diff: () => "",
    tail: () => "",
    diffTail: () => "",
    sections: () => [],
    vars: { ...vars, qualityReviews },
    edges: [],
  }
}

const scriptFor = (stateName: string, context: TemplateContext): string => {
  const { definition } = compileTemplate()
  const state = definition.states[stateName]
  if (state?.script === undefined) throw new Error(`"${stateName}" is not a script state`)
  return renderStateTemplate(state.script, context)
}

const freshDir = (): string => mkdtempSync(join(tmpdir(), "quality-lap-scripts-"))

const runSh = async (dir: string, script: string): Promise<void> => {
  await execFileAsync("sh", ["-c", script], { cwd: dir })
}

const readIfExists = (dir: string, ...parts: string[]): string | undefined => {
  try {
    return readFileSync(join(dir, ...parts), "utf8")
  } catch {
    return undefined
  }
}

const runSeeding = (dir: string, qualityReviews: string): Promise<void> =>
  runSh(dir, scriptFor("build.quality.seeding", baseContext(dir, qualityReviews)))

const runPicking = (dir: string): Promise<void> =>
  runSh(dir, scriptFor("build.quality.picking", baseContext(dir, "")))

describe("build.quality.seeding, rendered and executed for real", () => {
  it("writes one padded, zero-indexed, trimmed file per comma-separated entry, in list order", async () => {
    const dir = freshDir()
    await runSeeding(dir, "owasp-security, code-simplification")

    expect(readIfExists(dir, ".gtd", "reviews", "01-owasp-security.md")).toBe("owasp-security")
    expect(readIfExists(dir, ".gtd", "reviews", "02-code-simplification.md")).toBe(
      "code-simplification",
    )
    expect(readdirSync(join(dir, ".gtd", "reviews")).sort()).toEqual([
      "01-owasp-security.md",
      "02-code-simplification.md",
    ])
  })

  it("a blank qualityReviews leaves .gtd/reviews/ present and empty", async () => {
    const dir = freshDir()
    await runSeeding(dir, "")

    expect(readdirSync(join(dir, ".gtd", "reviews"))).toEqual([])
  })

  it("with .gtd/QUALITY_DONE.md present, exits 0 and writes nothing, even for a non-blank list", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })
    writeFileSync(join(dir, ".gtd", "QUALITY_DONE.md"), "")

    await runSeeding(dir, "owasp-security")

    // The guard short-circuits before `mkdir -p .gtd/reviews` ever runs, so
    // the directory itself must be ABSENT — stronger than the blank-list
    // case's "present and empty" — and `readIfExists` can't tell a missing
    // dir from a populated one (`readFileSync` on a directory throws
    // EISDIR either way), so this must check existence directly.
    expect(existsSync(join(dir, ".gtd", "reviews"))).toBe(false)
  })
})

describe("build.quality.picking, rendered and executed for real", () => {
  const seedTwo = (dir: string): void => {
    mkdirSync(join(dir, ".gtd", "reviews"), { recursive: true })
    writeFileSync(join(dir, ".gtd", "reviews", "01-owasp-security.md"), "owasp-security")
    writeFileSync(join(dir, ".gtd", "reviews", "02-code-simplification.md"), "code-simplification")
  }

  it("copies the lexically first queue file into NEXT_REVIEW.md and deletes it, leaving the other", async () => {
    const dir = freshDir()
    seedTwo(dir)

    await runPicking(dir)

    expect(readIfExists(dir, ".gtd", "NEXT_REVIEW.md")).toBe("owasp-security")
    expect(readdirSync(join(dir, ".gtd", "reviews")).sort()).toEqual(["02-code-simplification.md"])
  })

  it("a second call drains the remaining entry the same way", async () => {
    const dir = freshDir()
    seedTwo(dir)

    await runPicking(dir)
    await runPicking(dir)

    expect(readIfExists(dir, ".gtd", "NEXT_REVIEW.md")).toBe("code-simplification")
    expect(readdirSync(join(dir, ".gtd", "reviews"))).toEqual([])
  })

  it("a third call on an empty queue removes NEXT_REVIEW.md and writes QUALITY_DONE.md", async () => {
    const dir = freshDir()
    seedTwo(dir)

    await runPicking(dir)
    await runPicking(dir)
    await runPicking(dir)

    expect(readIfExists(dir, ".gtd", "NEXT_REVIEW.md")).toBeUndefined()
    expect(readIfExists(dir, ".gtd", "QUALITY_DONE.md")).toBe("")
  })

  it("draining with a non-empty QUALITY.md also writes QUALITY_READY.md", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd", "reviews"), { recursive: true })
    writeFileSync(join(dir, ".gtd", "QUALITY.md"), "## finding\nsomething blocking\n")

    await runPicking(dir)

    expect(readIfExists(dir, ".gtd", "QUALITY_DONE.md")).toBe("")
    expect(readIfExists(dir, ".gtd", "QUALITY_READY.md")).toBe("")
  })

  it("draining with an absent QUALITY.md writes QUALITY_DONE.md but not QUALITY_READY.md", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd", "reviews"), { recursive: true })

    await runPicking(dir)

    expect(readIfExists(dir, ".gtd", "QUALITY_DONE.md")).toBe("")
    expect(readIfExists(dir, ".gtd", "QUALITY_READY.md")).toBeUndefined()
  })

  it("draining with a zero-byte QUALITY.md writes QUALITY_DONE.md but not QUALITY_READY.md", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd", "reviews"), { recursive: true })
    writeFileSync(join(dir, ".gtd", "QUALITY.md"), "")

    await runPicking(dir)

    expect(readIfExists(dir, ".gtd", "QUALITY_DONE.md")).toBe("")
    expect(readIfExists(dir, ".gtd", "QUALITY_READY.md")).toBeUndefined()
  })
})
