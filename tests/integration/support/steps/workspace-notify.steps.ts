import { Given, Then, type DataTable } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import type { WorkspaceBench } from "../workspace.js"
import { bench } from "./workspace.steps.js"

// `<HEAD of portal/plan>` stands for that worktree's HEAD commit, and
// `<path of portal/plan>` for its path, URL-encoded.
const filled = async (b: WorkspaceBench, cell: string): Promise<string> => {
  let text = cell
  for (const [placeholder, what, ref] of cell.matchAll(/<(HEAD|path) of ([^>]+)>/g)) {
    const path = await b.pathOf(ref!)
    const [project] = ref!.split("/") as [string]
    const head = (await b.worktrees.adapter.list(project)).find((w) => w.path === path)!.head
    text = text.replace(placeholder, what === "HEAD" ? head : encodeURIComponent(path))
  }
  return text
}

Given("publishing a notification fails with {string}", (world: GtdWorld, message: string) => {
  bench(world).notifications.unavailable(message)
})

// `link` is the URL without the workspace's own address.
Then("gtd sent these notifications:", async (world: GtdWorld, table: DataTable) => {
  const b = bench(world)
  const columns: readonly string[] = table.raw()[0] ?? []
  const sent = b.notifications.published().map((n) => {
    const url = n.url === undefined ? undefined : new URL(n.url)
    const fields: Record<string, string> = {
      key: n.key,
      title: n.title,
      body: n.body,
      priority: n.priority,
      link: url === undefined ? "" : `${url.pathname}${url.search}`,
    }
    return Object.fromEntries(columns.map((c) => [c, fields[c] ?? ""]))
  })
  const expected: Record<string, string>[] = []
  for (const row of table.hashes() as Record<string, string>[]) {
    const cells: Record<string, string> = {}
    for (const [column, cell] of Object.entries(row)) cells[column] = await filled(b, cell)
    expected.push(cells)
  }
  assert.deepStrictEqual(sent, expected)
})

Then("gtd sent no notification", (world: GtdWorld) => {
  assert.deepStrictEqual(bench(world).notifications.published(), [])
})

Then("the supervisor printed:", (world: GtdWorld, text: string) => {
  const output = bench(world).output
  assert.ok(output.includes(text.trim()), output)
})
