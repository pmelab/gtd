import { Then, type DataTable } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

Then("the dashboard page names these meta tags:", async (world: GtdWorld, table: DataTable) => {
  const html = await (await bench(world).request("/")).text()
  const metas = [...html.matchAll(/<meta name="(gtd-[^"]*)" content="([^"]*)">/g)]
    .map(([, name, content]) => ({ name: name!, content: content! }))
    .sort((a, b) => a.name.localeCompare(b.name))
  assert.deepStrictEqual(metas, table.hashes())
})
