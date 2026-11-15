import { Given, Then, When, type DataTable } from "quickpickle"
import assert from "node:assert"
import { setTimeout as delay } from "node:timers/promises"
import type { Action } from "../../../../src/workspace/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

const results = new WeakMap<GtdWorld, unknown>()

const target = async (world: GtdWorld, ref: string) => {
  const [project] = ref.split("/") as [string]
  return { project, worktree: await bench(world).pathOf(ref) }
}

Given("the actions adapter offers these actions:", (world: GtdWorld, actions: string) => {
  bench(world).actions.offer(JSON.parse(actions) as readonly Action[])
})

Then(
  "the action picker of {string} offers:",
  async (world: GtdWorld, ref: string, table: DataTable) => {
    const picker = (await bench(world).call("actions", await target(world, ref), "query")) as {
      status: string
      actions: readonly Action[]
    }
    const rows = picker.actions.map((a) => ({
      status: picker.status,
      action: a.id,
      fields: a.fields.map((f) => f.name).join(", "),
    }))
    assert.deepStrictEqual(rows, table.hashes())
  },
)

const runAction = async (world: GtdWorld, id: string, ref: string, values: unknown) => {
  const input = { ...(await target(world, ref)), action: id, values }
  results.set(world, await bench(world).call("runAction", input, "mutation"))
}

When("I run the action {string} in {string}", async (world: GtdWorld, id: string, ref: string) => {
  await runAction(world, id, ref, {})
})

When(
  "I run the action {string} in {string} with:",
  async (world: GtdWorld, id: string, ref: string, values: string) => {
    await runAction(world, id, ref, JSON.parse(values))
  },
)

Then("gtd refuses the action with:", (world: GtdWorld, message: string) => {
  const error = results.get(world) as { message?: string } | undefined
  assert.strictEqual(error?.message, message.trim(), JSON.stringify(error))
})

Then("gtd opened these action panes:", async (world: GtdWorld, table: DataTable) => {
  const b = bench(world)
  const opened = await Promise.all(
    b.terminal
      .panes()
      .filter((pane) => "GTD_WORKSPACE_STATUS" in pane.env)
      .map(async (pane) => ({
        worktree: await b.refOf(pane.worktree),
        argv: JSON.stringify(pane.argv),
      })),
  )
  assert.deepStrictEqual(opened, table.hashes())
})

// `<HEAD>` stands for the worktree's HEAD commit.
Then(
  "the action in {string} got GTD_WORKSPACE_STATUS:",
  async (world: GtdWorld, ref: string, expected: string) => {
    const b = bench(world)
    const handle = await b.actionPaneOf(ref)
    const pane = b.terminal.panes().find((p) => p.handle === handle)!
    const [project, branch] = ref.split("/") as [string, string]
    const head = (await b.worktrees.adapter.list(project)).find((w) => w.branch === branch)!.head
    assert.deepStrictEqual(
      JSON.parse(pane.env["GTD_WORKSPACE_STATUS"]!),
      JSON.parse(expected.replaceAll("<HEAD>", head)),
    )
  },
)

// Returns once the supervisor shows the exit on the worktree, so whatever
// follows a start action's exit has happened.
When("the action in {string} exits {int}", async (world: GtdWorld, ref: string, code: number) => {
  const b = bench(world)
  b.terminal.exit(await b.actionPaneOf(ref), code)
  const path = await b.pathOf(ref)
  for (let i = 0; i < 200; i++) {
    const shown = (await b.projects())
      .flatMap((p) => p.worktrees)
      .find((w) => w.path === path)?.action
    if (shown?.exit === code) return
    await delay(10)
  }
  assert.fail(`the supervisor never showed exit ${code} in ${ref}`)
})

Then("the Projects view shows these last actions:", async (world: GtdWorld, table: DataTable) => {
  const rows = (await bench(world).projects()).flatMap((project) =>
    project.worktrees.flatMap((w) =>
      w.action === undefined
        ? []
        : [
            {
              worktree: `${project.id}/${w.branch ?? w.path}`,
              action: w.action.id,
              exit: w.action.exit === null ? "running" : String(w.action.exit),
            },
          ],
    ),
  )
  assert.deepStrictEqual(rows, table.hashes())
})
