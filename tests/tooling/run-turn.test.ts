import { describe, expect, it } from "vitest"
import { buildPiArgv, PINNED_TOOLS } from "../../evals/run-turn.mjs"

describe("buildPiArgv", () => {
  it("pins pi's tool surface to the four docs/development.md promises", () => {
    const argv = buildPiArgv("some-model", "system prompt", "key")
    const toolsIdx = argv.indexOf("--tools")
    expect(toolsIdx).toBeGreaterThanOrEqual(0)
    expect(argv[toolsIdx + 1]).toBe(PINNED_TOOLS)
    expect(PINNED_TOOLS).toBe("read,write,edit,bash")
  })
})
