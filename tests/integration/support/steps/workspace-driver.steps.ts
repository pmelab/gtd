import { Given, Then, When, type DataTable } from "quickpickle"
import assert from "node:assert"
import { settle } from "../../../../src/twins/index.js"
import type { StatusRecord } from "../../../../src/workspace/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

Given(
  "a driver that an earlier supervisor started runs in {string}",
  async (world: GtdWorld, ref: string) => {
    await bench(world).seedDriver(ref)
  },
)

Given("the driver in {string} reports:", async (world: GtdWorld, ref: string, record: string) => {
  const b = bench(world)
  b.terminal.report(await b.paneOf(ref), JSON.parse(record) as StatusRecord)
  await settle()
})

Given(
  "the driver in {string} reports without a hint:",
  async (world: GtdWorld, ref: string, record: string) => {
    const b = bench(world)
    b.terminal.report(await b.paneOf(ref), JSON.parse(record) as StatusRecord, true)
  },
)

When("the driver in {string} exits {int}", async (world: GtdWorld, ref: string, code: number) => {
  const b = bench(world)
  b.terminal.exit(await b.paneOf(ref), code)
  await settle()
})

Given(
  /^the (driver|action) pane of "([^"]*)" is gone$/,
  async (world: GtdWorld, kind: string, ref: string) => {
    const b = bench(world)
    b.terminal.lose(kind === "driver" ? await b.paneOf(ref) : await b.actionPaneOf(ref))
    await settle()
  },
)

Then("gtd opened these driver panes:", async (world: GtdWorld, table: DataTable) => {
  const b = bench(world)
  const opened = await Promise.all(
    b.terminal
      .panes()
      .filter((pane) => !b.seeded.has(pane.handle) && !("GTD_WORKSPACE_STATUS" in pane.env))
      .map(async (pane) => ({
        worktree: await b.refOf(pane.worktree),
        argv: pane.argv.join(" "),
      })),
  )
  assert.deepStrictEqual(opened, table.hashes())
})

Then("the driver in {string} still runs", async (world: GtdWorld, ref: string) => {
  const b = bench(world)
  const status = await b.terminal.adapter.status(await b.paneOf(ref))
  assert.strictEqual(status?.alive, true, JSON.stringify(status))
})
