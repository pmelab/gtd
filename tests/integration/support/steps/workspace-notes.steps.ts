import { Then } from "quickpickle"
import assert from "node:assert"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { stateDirectory } from "../../../../src/supervisor/index.js"
import type { GtdWorld } from "../world.js"
import type { WorkspaceBench } from "../workspace.js"
import { bench } from "./workspace.steps.js"

const noteOf = async (b: WorkspaceBench, ref: string) => {
  const path = await b.pathOf(ref)
  const view = (await b.projects()).flatMap((p) => p.worktrees).find((w) => w.path === path)
  assert.ok(view !== undefined, `the Projects view does not list ${ref}`)
  return view.note
}

Then(
  "the Projects view shows the note on {string}:",
  async (world: GtdWorld, ref: string, message: string) => {
    assert.strictEqual((await noteOf(bench(world), ref))?.message, message.trim())
  },
)

Then("the Projects view shows no note on {string}", async (world: GtdWorld, ref: string) => {
  assert.strictEqual(await noteOf(bench(world), ref), undefined)
})

Then("the supervisor's spool is empty", (world: GtdWorld) => {
  const b = bench(world)
  assert.deepStrictEqual(readdirSync(join(stateDirectory(b.stateHome, b.root), "spool")), [])
})
