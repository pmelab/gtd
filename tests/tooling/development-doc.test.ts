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

// Every assertion below runs against whitespace-collapsed prose, never the
// raw file: `.gtd/`-style oxfmt formatting reflows this document on every
// touch, so a phrase pinned here lands mid-wrap sooner or later. Pinning the
// FACT and not the line break is the difference between a test that catches
// a doc going wrong and one that reds on an unrelated edit.
function flowed() {
  return promptEvalsSection().replace(/\s+/g, " ")
}

// The unit a line-oriented check wants, once wrapping is gone.
function sentences() {
  return flowed().split(/(?<=\.) /)
}

describe("docs/development.md ## Prompt evals", () => {
  it("never describes providers as competing models — only per-cell-matrix hits survive", () => {
    const hits = sentences().filter((sentence) =>
      /matrix|per model|both models|against a real model/i.test(sentence),
    )
    for (const sentence of hits) {
      expect(sentence.toLowerCase()).toMatch(/per-cell results matrix/)
    }
  })

  it("names a case's state, its class, the one committed configuration, comparing models, and baseline labels", () => {
    const section = flowed()
    expect(section).toMatch(/names a workflow `state`, never a model/)
    expect(section).toMatch(/class[\s\S]*?picks which half of the configuration runs it/)
    expect(section).toMatch(/exactly ONE configuration/)
    expect(section).toMatch(/every extra provider multiplies/)
    expect(section).toMatch(/add a second `providers:` entry/)
    expect(section).toMatch(/[Bb]aseline cells key off[\s\S]*?provider `?label`?/)
  })

  it("states npm run eval always runs every case, and the tier-3 judge is pinned", () => {
    const section = flowed()
    expect(section).toMatch(/runs every case every time/)
    expect(section).toMatch(/no default subset/)
    expect(section).toMatch(/pinned to a specific model id/)
    expect(section).toMatch(/invalidates.*baseline/)
  })

  it("states the harness's tool surface is pinned via a pi flag, matching evals/run-turn.mjs", () => {
    const section = flowed()
    expect(section).toMatch(/--tools read,write,edit,bash/)
  })
})
