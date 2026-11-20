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

Then(
  "the dashboard page has these home-screen meta tags:",
  async (world: GtdWorld, table: DataTable) => {
    const html = await (await bench(world).request("/")).text()
    for (const { name, content } of table.hashes()) {
      assert.match(html, new RegExp(`<meta name="${name}" content="${content}"`))
    }
  },
)

Then("the dashboard page links the manifest {string}", async (world: GtdWorld, href: string) => {
  const html = await (await bench(world).request("/")).text()
  assert.match(html, new RegExp(`<link rel="manifest" href="${href.replace(".", "\\.")}"`))
})

Then(
  "the dashboard viewport has {string} and {string}",
  async (world: GtdWorld, a: string, b: string) => {
    const html = await (await bench(world).request("/")).text()
    const viewport = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1] ?? ""
    assert.ok(viewport.includes(a) && viewport.includes(b), viewport)
  },
)

Then(
  "the dashboard manifest is a standalone app named {string} with theme_color, background_color and 2 icons",
  async (world: GtdWorld, name: string) => {
    const manifest = (await (await bench(world).request("/manifest.webmanifest")).json()) as {
      name: string
      display: string
      theme_color: string
      background_color: string
      icons: unknown[]
    }
    assert.equal(manifest.name, name)
    assert.equal(manifest.display, "standalone")
    assert.ok(manifest.theme_color && manifest.background_color)
    assert.ok(manifest.icons.length >= 2)
  },
)
