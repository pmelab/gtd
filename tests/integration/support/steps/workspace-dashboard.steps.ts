import { Given, Then, When, type DataTable } from "quickpickle"
import assert from "node:assert"
import { inMemoryTerminal } from "../../../../src/twins/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

Then("the dashboard page names these meta tags:", async (world: GtdWorld, table: DataTable) => {
  const html = await (await bench(world).request("/")).text()
  const metas = [...html.matchAll(/<meta name="(gtd-[^"]*)" content="([^"]*)">/g)]
    .map(([, name, content]) => ({ name: name!, content: content! }))
    .sort((a, b) => a.name.localeCompare(b.name))
  assert.deepStrictEqual(metas, table.hashes())
})

Given(
  "the terminal adapter attaches to a pane with {string}",
  (world: GtdWorld, format: string) => {
    bench(world).terminal = inMemoryTerminal({
      attach: (handle) => format.replace("<handle>", handle),
    })
  },
)

Given("the person's login shell is {string}", (world: GtdWorld, shell: string) => {
  bench(world).loginShell = shell
})

const target = async (world: GtdWorld, ref: string) => {
  const [project] = ref.split("/") as [string]
  return { project, worktree: await bench(world).pathOf(ref) }
}

const opened = new WeakMap<GtdWorld, unknown>()

Then(
  "the Terminal tab of {string} attaches to the driver's pane with {string}",
  async (world: GtdWorld, ref: string, format: string) => {
    const b = bench(world)
    const view = await b.call("terminal", await target(world, ref), "query")
    assert.deepStrictEqual(view, { attach: format.replace("<handle>", await b.paneOf(ref)) })
  },
)

Then("the Terminal tab of {string} offers no attach", async (world: GtdWorld, ref: string) => {
  assert.deepStrictEqual(await bench(world).call("terminal", await target(world, ref), "query"), {})
})

When("I open a shell pane in {string}", async (world: GtdWorld, ref: string) => {
  opened.set(world, await bench(world).call("openShell", await target(world, ref), "mutation"))
})

When(
  "I open a shell pane in {string} as if it were in project {string}",
  async (world: GtdWorld, ref: string, project: string) => {
    const input = { ...(await target(world, ref)), project }
    opened.set(world, await bench(world).call("openShell", input, "mutation"))
  },
)

Then("gtd opened these shell panes:", async (world: GtdWorld, table: DataTable) => {
  const b = bench(world)
  const panes = await Promise.all(
    b.terminal
      .panes()
      .filter((pane) => b.isShellPane(pane))
      .map(async (pane) => ({
        worktree: await b.refOf(pane.worktree),
        argv: JSON.stringify(pane.argv),
      })),
  )
  assert.deepStrictEqual(panes, table.hashes())
})

Then(
  "the shell pane of {string} attaches with {string}",
  async (world: GtdWorld, ref: string, format: string) => {
    const handle = await bench(world).shellPaneOf(ref)
    assert.deepStrictEqual(opened.get(world), { attach: format.replace("<handle>", handle) })
  },
)
