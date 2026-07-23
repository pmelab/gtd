import { Then } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// ── Review checkout window: refs + surfaced status ────────────────────────────

Then("the git ref {string} exists", (world: GtdWorld, ref: string) => {
  assert.ok(world.gitRefExists(ref), `Expected the git ref "${ref}" to exist.`)
})

Then("the git ref {string} does not exist", (world: GtdWorld, ref: string) => {
  assert.ok(!world.gitRefExists(ref), `Expected the git ref "${ref}" NOT to exist.`)
})

Then("the git status contains {string}", (world: GtdWorld, text: string) => {
  const status = world.gitStatus()
  assert.ok(status.includes(text), `Expected git status to contain "${text}". Got:\n${status}`)
})

Then("the git status does not contain {string}", (world: GtdWorld, text: string) => {
  const status = world.gitStatus()
  assert.ok(!status.includes(text), `Expected git status NOT to contain "${text}". Got:\n${status}`)
})
