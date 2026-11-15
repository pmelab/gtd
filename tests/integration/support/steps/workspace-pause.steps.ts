import { Then, When, type DataTable } from "quickpickle"
import assert from "node:assert"
import { setTimeout as delay } from "node:timers/promises"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

// "portal" is a project, "portal/bugs" a feed of it.
const scopeOf = (ref: string) => {
  const [project, feed] = ref.split("/")
  return { project, ...(feed !== undefined ? { feed } : {}) }
}

const setPause = async (world: GtdWorld, procedure: string, ref: string) => {
  const response = await bench(world).post(`/trpc/${procedure}`, scopeOf(ref))
  assert.strictEqual(response.status, 200, await response.text())
}

When("I pause dispatch of {string} in the Inbox", (world: GtdWorld, ref: string) =>
  setPause(world, "pause", ref),
)

When("I resume dispatch of {string} in the Inbox", (world: GtdWorld, ref: string) =>
  setPause(world, "resume", ref),
)

// An empty cell is the workspace, or the whole project.
Then("the Inbox reports these pauses:", async (world: GtdWorld, table: DataTable) => {
  const { paused } = await bench(world).inbox()
  assert.deepStrictEqual(
    paused.map((scope) => ({ project: scope.project ?? "", feed: scope.feed ?? "" })),
    table.hashes(),
  )
})

When(
  "I run {string} in the workspace without waiting for it",
  async (world: GtdWorld, command: string) => {
    const b = bench(world)
    const [gtd, ...args] = command.split(/\s+/)
    assert.strictEqual(gtd, "gtd")
    b.lastCommand = undefined
    b.runningCommand = b.command(args)
    // Until the supervisor holds the request, a step that moves its clock would come too early.
    for (let i = 0; i < 200 && (await b.inbox()).paused.length === 0; i++) await delay(10)
  },
)

Then("the command still runs", async (world: GtdWorld) => {
  await delay(50)
  assert.strictEqual(bench(world).lastCommand, undefined, "the command has returned")
})
