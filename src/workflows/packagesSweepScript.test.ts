import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { renderStateTemplate, type TemplateContext } from "../PatternTemplates.js"
import { compileTemplate } from "./index.js"

const execFileAsync = promisify(execFile)

/**
 * Runs `packages-sweep` for real — same render path
 * `tests/tooling/shell-corpus.test.ts` and `scripts/generate-shell-corpus.ts`
 * use — rather than a hand-written fabrication of what the script would do.
 * `default-workflow.feature`/`smoke.feature`/`planning-phase-judgments.feature`
 * stay `@inmem` and land this state on an already-clean tree (gtd's ROUTING
 * only); this covers the sweep's own five-pattern `rm -f` line, so a dropped
 * pattern fails here rather than shipping silently
 * (.gtd/packages/04-migrate-bundled-loops.md Task 3). Lives beside
 * `qualityLapScripts.test.ts`/`reviewLapScripts.test.ts`/
 * `specReviewScripts.test.ts` — same shape, same `test-owns-impl` sibling
 * import of `renderStateTemplate`, no barrel export needed for it.
 */

const context = (): TemplateContext => {
  const { vars } = compileTemplate()
  return {
    startCommit: "",
    currentCommit: "",
    previousCommit: "",
    state: "packages-sweep",
    actor: "check",
    reviewBase: "",
    processBase: "",
    processCost: 0,
    processCostByModel: [],
    read: () => "",
    diff: () => "",
    sections: () => [],
    tail: () => "",
    diffTail: () => "",
    vars,
    edges: [],
    item: "",
    itemIndex: -1,
  }
}

const scriptFor = (stateName: string): string => {
  const { definition } = compileTemplate()
  const state = definition.states[stateName]
  if (state?.script === undefined) throw new Error(`"${stateName}" is not a script state`)
  return renderStateTemplate(state.script, context())
}

const freshDir = (): string => mkdtempSync(join(tmpdir(), "packages-sweep-script-"))

const runSweep = async (dir: string): Promise<void> => {
  await execFileAsync("sh", ["-c", scriptFor("packages-sweep")], { cwd: dir })
}

const SWEPT_FILES = [
  ".gtd/REQUIREMENTS.md",
  ".gtd/ARCHITECTURE.md",
  ".gtd/QUESTIONS.md",
  ".gtd/REVIEW_RAW.md",
  ".gtd/QUALITY.md",
  ".gtd/QUALITY_DONE.md",
]

describe("packages-sweep, rendered and executed for real", () => {
  it("sweeps every one of REQUIREMENTS.md/ARCHITECTURE.md/QUESTIONS.md/REVIEW_RAW.md/QUALITY*.md when present", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })
    for (const f of SWEPT_FILES) writeFileSync(join(dir, f), "leftover\n")

    await runSweep(dir)

    for (const f of SWEPT_FILES) {
      expect(existsSync(join(dir, f)), f).toBe(false)
    }
  })

  it("leaves an unrelated .gtd file untouched", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })
    writeFileSync(join(dir, ".gtd", "SATISFIED.md"), "keep me\n")

    await runSweep(dir)

    expect(existsSync(join(dir, ".gtd", "SATISFIED.md"))).toBe(true)
  })

  it("on an already-clean .gtd/ (nothing to sweep), exits 0 with no error", async () => {
    const dir = freshDir()
    mkdirSync(join(dir, ".gtd"), { recursive: true })

    await expect(runSweep(dir)).resolves.toBeUndefined()
  })
})
