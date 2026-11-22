import { Given, Then, When, type DataTable } from "quickpickle"
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
      kind: n.kind,
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

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: "BPk", auth: "auth" },
})

When(
  "I subscribe the device {string} with kinds {string}",
  async (world: GtdWorld, endpoint: string, kinds: string) => {
    await bench(world).call(
      "pushSubscribe",
      { subscription: subscription(endpoint), kinds: kinds.split(",") },
      "mutation",
    )
  },
)

When("I unsubscribe the device {string}", async (world: GtdWorld, endpoint: string) => {
  await bench(world).call("pushUnsubscribe", { endpoint }, "mutation")
})

Then(
  "the adapter knows the device {string} with kinds {string}",
  async (world: GtdWorld, endpoint: string, kinds: string) => {
    const known = await bench(world).notifications.adapter.device(endpoint)
    assert.deepStrictEqual(known?.kinds, kinds.split(","))
  },
)

Then("the adapter does not know the device {string}", async (world: GtdWorld, endpoint: string) => {
  assert.strictEqual(await bench(world).notifications.adapter.device(endpoint), undefined)
})

Then("the dashboard's push key is {string}", async (world: GtdWorld, key: string) => {
  assert.strictEqual(await bench(world).call("pushKey", undefined, "query"), key)
})

Then("the supervisor printed no push line", (world: GtdWorld) => {
  assert.ok(!bench(world).output.includes("turn on push"), bench(world).output)
})
