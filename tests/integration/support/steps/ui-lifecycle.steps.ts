import { Then, When } from "quickpickle"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// ── gtd ui's handoff — a real done mutation against a real spawned process (`@live` only, see world.ts#spawnGtdUiAndHandOff) ──

When(
  "I hand off {string} in mode {string} with the text {string} to a spawned gtd ui",
  async (world: GtdWorld, filePath: string, mode: string, text: string) => {
    await world.spawnGtdUiAndHandOff(filePath, mode, text)
  },
)

Then("the file {string} contains {string}", (world: GtdWorld, path: string, text: string) => {
  const content = readFileSync(join(world.repoDir, path), "utf8")
  assert.ok(
    content.includes(text),
    `expected ${path} to contain ${JSON.stringify(text)}, got:\n${content}`,
  )
})

Then(
  "the file {string} does not contain {string}",
  (world: GtdWorld, path: string, text: string) => {
    const content = existsSync(join(world.repoDir, path))
      ? readFileSync(join(world.repoDir, path), "utf8")
      : ""
    assert.ok(!content.includes(text), `expected ${path} not to contain ${JSON.stringify(text)}`)
  },
)
