import { Given, Then, When, type DataTable } from "quickpickle"
import assert from "node:assert"
import { settle } from "../../../../src/twins/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

const results = new WeakMap<GtdWorld, unknown>()

const split = (ref: string): [string, string] => ref.split("/") as [string, string]

Given("{string} is merged into main", (world: GtdWorld, ref: string) => {
  bench(world).worktrees.merge(...split(ref))
})

Given("{string} has uncommitted changes", (world: GtdWorld, ref: string) => {
  bench(world).worktrees.dirty(...split(ref), true)
})

Given(
  /^a person runs a command in the (driver) pane of "([^"]*)"$/,
  async (world: GtdWorld, _kind: string, ref: string) => {
    const b = bench(world)
    const handle = await b.paneOf(ref)
    b.terminal.panes().find((p) => p.handle === handle)!.busy = true
    await settle()
  },
)

When(
  "I create the worktree {string} in {string}",
  async (world: GtdWorld, branch: string, project: string) => {
    results.set(world, await bench(world).call("createWorktree", { project, branch }, "mutation"))
  },
)

const remove = async (world: GtdWorld, ref: string, confirmed: boolean) => {
  const b = bench(world)
  const input = { project: split(ref)[0], worktree: await b.pathOf(ref), confirmed }
  results.set(world, await b.call("removeWorktree", input, "mutation"))
}

When("I remove {string}", (world: GtdWorld, ref: string) => remove(world, ref, false))

When("I remove {string} and confirm", (world: GtdWorld, ref: string) => remove(world, ref, true))

Then("gtd refuses the worktree change with:", (world: GtdWorld, message: string) => {
  const error = results.get(world) as { message?: string } | undefined
  assert.strictEqual(error?.message, message.trim(), JSON.stringify(error))
})

Then("gtd asks to confirm:", (world: GtdWorld, reasons: string) => {
  const result = results.get(world) as { confirm?: readonly string[] } | undefined
  assert.deepStrictEqual(result?.confirm, reasons.trim().split("\n"), JSON.stringify(result))
})

Then("gtd made these adapter calls:", (world: GtdWorld, table: DataTable) => {
  assert.deepStrictEqual(bench(world).calls, table.hashes())
})

Then("gtd made no adapter calls", (world: GtdWorld) => {
  assert.deepStrictEqual(bench(world).calls, [])
})
