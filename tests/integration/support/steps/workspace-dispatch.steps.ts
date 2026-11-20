import { Given, Then, When } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

const split = (ref: string): [string, string] => {
  const slash = ref.indexOf("/")
  return [ref.slice(0, slash), ref.slice(slash + 1)]
}

Given("{string} has no uncommitted changes", (world: GtdWorld, ref: string) => {
  bench(world).worktrees.dirty(...split(ref), false)
})

When(
  "the worktree {string} moves to the branch {string}",
  (world: GtdWorld, ref: string, to: string) => {
    const [project, branch] = split(ref)
    bench(world).worktrees.rename(project, branch, to)
  },
)

When("the worktree {string} is gone but its branch stays", (world: GtdWorld, ref: string) => {
  bench(world).worktrees.leave(...split(ref))
})

Given("{string} has a commit that is on no remote", (world: GtdWorld, ref: string) => {
  bench(world).worktrees.commit(...split(ref))
})

Given("the tree of {string} has uncommitted changes", (world: GtdWorld, ref: string) => {
  bench(world).worktrees.dirty(...split(ref), true)
})

const press = async (world: GtdWorld, procedure: string, ref: string) => {
  const [feed, key] = split(ref)
  const response = await bench(world).post(`/trpc/${procedure}`, { feed, key })
  assert.strictEqual(response.status, 200, await response.text())
}

When("I start {string} in the Inbox", (world: GtdWorld, ref: string) =>
  press(world, "startItem", ref),
)

When("I retry {string} in the Inbox", (world: GtdWorld, ref: string) =>
  press(world, "retryItem", ref),
)

const itemOf = (world: GtdWorld, handle: string): unknown => {
  const pane = bench(world)
    .terminal.panes()
    .find((p) => p.handle === handle)!
  return JSON.parse(pane.env["GTD_WORKSPACE_ITEM"] ?? "null")
}

Then(
  "the action in {string} got GTD_WORKSPACE_ITEM:",
  async (world: GtdWorld, ref: string, expected: string) => {
    const handle = await bench(world).actionPaneOf(ref)
    assert.deepStrictEqual(itemOf(world, handle), JSON.parse(expected))
  },
)

Then(
  "the driver in {string} got GTD_WORKSPACE_ITEM:",
  async (world: GtdWorld, ref: string, expected: string) => {
    const handle = await bench(world).paneOf(ref)
    assert.deepStrictEqual(itemOf(world, handle), JSON.parse(expected))
  },
)

Given("the command {string} exits {int}", (world: GtdWorld, argv: string, status: number) => {
  bench(world).commands.set(argv, { status, stdout: "", stderr: "" })
})

When("the terminal adapter stops answering", (world: GtdWorld) => {
  bench(world).terminalStopped = true
})

// "2 of 3", or "2" when no `limits.maxDrives` is set.
Then("the Inbox counts {string} drives in use", async (world: GtdWorld, expected: string) => {
  const { drives } = await bench(world).inbox()
  assert.strictEqual(
    drives.max === undefined ? `${drives.inUse}` : `${drives.inUse} of ${drives.max}`,
    expected,
  )
})
