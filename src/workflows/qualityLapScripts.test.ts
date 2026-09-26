import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { renderStateTemplate, type TemplateContext } from "../PatternTemplates.js"
import { compileTemplate } from "./index.js"

const execFileAsync = promisify(execFile)

/**
 * Runs `build.quality-gate`/`build.quality-check` for real — same render path
 * `tests/tooling/shell-corpus.test.ts` and `scripts/generate-shell-corpus.ts`
 * use — rather than a hand-written fabrication of what the script would do.
 * `tests/integration/features/quality-review-lap.feature` stays `@inmem` and
 * covers gtd's ROUTING only; this covers the two scripts' own mechanics.
 * `build.quality`'s own per-lens loop is now `each: { var: qualityReviews }`
 * (see .gtd/packages/04-migrate-bundled-loops.md) — nothing left to seed or
 * pick by hand, so this file's own subject moved to the gate ahead of the
 * loop and the check after it. Lives beside `escalateScript.test.ts`/
 * `reviewLapScripts.test.ts`/`specReviewScripts.test.ts` — same shape, same
 * `test-owns-impl` sibling import of `renderStateTemplate`, no barrel export
 * needed for it.
 */

const baseContext = (dir: string): TemplateContext => {
  const { vars } = compileTemplate()
  return {
    startCommit: "",
    currentCommit: "",
    previousCommit: "",
    state: "build.quality-gate",
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
    vars,
    edges: [],
    item: "",
    itemIndex: -1,
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

const runQualityGate = (dir: string): Promise<void> =>
  runSh(dir, scriptFor("build.quality-gate", baseContext(dir)))

const runQualityCheck = (dir: string): Promise<void> =>
  runSh(dir, scriptFor("build.quality-check", baseContext(dir)))

describe("build.quality-gate, rendered and executed for real", () => {
  it("with no .gtd/QUALITY_DONE.md, exits clean — the lap has not run this episode, nothing written", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })

    await runQualityGate(dir)

    expect(existsSync(join(dir, ".gtd", "QUALITY_DONE.md"))).toBe(false)
  })

  it("with .gtd/QUALITY_DONE.md already present, appends a fresh HEAD-stamped line every call — never a no-op diff a repeat green route could stall on", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })
    writeFileSync(join(dir, ".gtd", "QUALITY_DONE.md"), "")

    await runQualityGate(dir)
    const first = readIfExists(dir, ".gtd", "QUALITY_DONE.md")
    expect(first).toContain("<!-- gtd quality-gate")

    await runQualityGate(dir)
    const second = readIfExists(dir, ".gtd", "QUALITY_DONE.md")
    expect(second).not.toBe(first)
    expect(second!.length).toBeGreaterThan(first!.length)
  })
})

describe("build.quality-check, rendered and executed for real", () => {
  it("with no .gtd/QUALITY.md at all, writes QUALITY_DONE.md and leaves QUALITY.md absent — a clean lap", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })

    await runQualityCheck(dir)

    expect(readIfExists(dir, ".gtd", "QUALITY_DONE.md")).toBe("quality lap drained\n")
    expect(existsSync(join(dir, ".gtd", "QUALITY.md"))).toBe(false)
  })

  it("with a non-blank .gtd/QUALITY.md, stamps it (keeping every finding) and writes QUALITY_DONE.md", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })
    writeFileSync(join(dir, ".gtd", "QUALITY.md"), "## finding\nsomething blocking\n")

    await runQualityCheck(dir)

    const quality = readIfExists(dir, ".gtd", "QUALITY.md")
    expect(quality).toContain("## finding")
    expect(quality).toContain("<!-- gtd quality-check")
    expect(readIfExists(dir, ".gtd", "QUALITY_DONE.md")).toBe("quality lap drained\n")
  })

  it("with a zero-byte .gtd/QUALITY.md, removes it and writes QUALITY_DONE.md", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })
    writeFileSync(join(dir, ".gtd", "QUALITY.md"), "")

    await runQualityCheck(dir)

    expect(existsSync(join(dir, ".gtd", "QUALITY.md"))).toBe(false)
    expect(readIfExists(dir, ".gtd", "QUALITY_DONE.md")).toBe("quality lap drained\n")
  })
})
