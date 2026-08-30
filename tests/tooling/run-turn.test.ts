import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildPiArgv, PINNED_TOOLS, readFeedback } from "../../evals/run-turn.mjs"

describe("buildPiArgv", () => {
  it("pins pi's tool surface to the four docs/development.md promises", () => {
    const argv = buildPiArgv("some-model", "system prompt", "key")
    const toolsIdx = argv.indexOf("--tools")
    expect(toolsIdx).toBeGreaterThanOrEqual(0)
    expect(argv[toolsIdx + 1]).toBe(PINNED_TOOLS)
    expect(PINNED_TOOLS).toBe("read,write,edit,bash")
  })
})

// No bundled case currently declares no `artifact` (every one of the nine
// needs some content read back), so this branch has no live case exercising
// it end to end — this is that coverage instead.
describe("readFeedback", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it("skips cleanly, reading nothing, when the case declares no artifact", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-run-turn-test-"))
    expect(readFeedback(dir, {})).toEqual({ feedbackExists: false, feedback: "" })
  })

  it("reports feedbackExists: false when the declared artifact isn't on disk", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-run-turn-test-"))
    expect(readFeedback(dir, { artifact: "src/missing.ts" })).toEqual({
      feedbackExists: false,
      feedback: "",
    })
  })

  it("reads the declared artifact's content back as feedback when present", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-run-turn-test-"))
    writeFileSync(join(dir, "src.ts"), "export const x = 1\n")
    expect(readFeedback(dir, { artifact: "src.ts" })).toEqual({
      feedbackExists: true,
      feedback: "export const x = 1\n",
    })
  })
})
