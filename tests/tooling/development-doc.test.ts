import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const DOC_PATH = fileURLToPath(new URL("../../docs/development.md", import.meta.url))

function promptEvalsSection() {
  const doc = readFileSync(DOC_PATH, "utf-8")
  const start = doc.indexOf("## Prompt evals")
  expect(start).toBeGreaterThanOrEqual(0)
  return doc.slice(start)
}

describe("docs/development.md ## Prompt evals", () => {
  it("never describes providers as competing models — only per-cell-matrix hits survive", () => {
    const section = promptEvalsSection()
    const hits = section
      .split("\n")
      .filter((line) => /matrix|per model|both models|against a real model/i.test(line))
    for (const line of hits) {
      expect(line.toLowerCase()).toMatch(/per-cell results matrix/)
    }
  })

  it("names a case's state, its class, the one committed configuration, comparing models, and baseline labels", () => {
    const section = promptEvalsSection()
    expect(section).toMatch(/names a workflow `state`, never a model/)
    expect(section).toMatch(/class[\s\S]*?picks which half of the configuration/)
    expect(section).toMatch(/exactly ONE configuration/)
    expect(section).toMatch(/every extra provider multiplies/)
    expect(section).toMatch(/add a second `providers:` entry/)
    expect(section).toMatch(/[Bb]aseline cells key off[\s\S]*?provider `?label`?/)
  })

  it("states npm run eval always runs every case, and the tier-3 judge is pinned", () => {
    const section = promptEvalsSection()
    expect(section).toMatch(/runs every case every time/)
    expect(section).toMatch(/no default subset/)
    expect(section).toMatch(/pinned to a specific model id/)
    expect(section).toMatch(/invalidates.*baseline/)
  })

  it("states the harness's tool surface is pinned via a pi flag, matching evals/run-turn.mjs", () => {
    const section = promptEvalsSection()
    expect(section).toMatch(/--tools read,write,edit,bash/)
  })
})
