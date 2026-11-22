import { Then, type DataTable } from "quickpickle"
import assert from "node:assert"
import { basename } from "node:path"
import { GTD_VERSION } from "../../../../src/install/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

Then("the dashboard page names these meta tags:", async (world: GtdWorld, table: DataTable) => {
  const html = await (await bench(world).request("/")).text()
  const metas = [...html.matchAll(/<meta name="(gtd-[^"]*)" content="([^"]*)">/g)]
    .map(([, name, content]) => ({ name: name!, content: content! }))
    .filter((m) => m.name !== "gtd-version")
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
    assert.ok(manifest.name.startsWith(name))
    assert.equal(manifest.display, "standalone")
    assert.ok(manifest.theme_color && manifest.background_color)
    assert.ok(manifest.icons.length >= 2)
  },
)

Then(
  "the dashboard manifest names the workspace directory, with the short name {string} and the scope {string}",
  async (world: GtdWorld, short: string, scope: string) => {
    const b = bench(world)
    const manifest = (await (await b.request("/manifest.webmanifest")).json()) as Record<
      string,
      unknown
    >
    assert.equal(manifest["name"], `gtd · ${basename(b.root)}`)
    assert.equal(manifest["short_name"], short)
    assert.equal(manifest["scope"], scope)
    assert.equal(manifest["start_url"], "/")
  },
)

Then(
  "the dashboard serves a service worker that caches only the app shell under the gtd version",
  async (world: GtdWorld) => {
    const script = await (await bench(world).request("/sw.js")).text()
    assert.ok(script.includes(`gtd-shell-${GTD_VERSION}`), script)
    assert.ok(script.includes("skipWaiting") && script.includes("clients.claim"))
    assert.ok(script.includes("caches.delete"))
    assert.ok(!script.includes("/trpc"), "the worker must not touch the API")
  },
)

Then("the dashboard page carries the supervisor's version", async (world: GtdWorld) => {
  const html = await (await bench(world).request("/")).text()
  assert.ok(html.includes(`<meta name="gtd-version" content="${GTD_VERSION}">`))
})

Then("the dashboard tells its version", async (world: GtdWorld) => {
  assert.equal(await bench(world).call("version", undefined, "query"), GTD_VERSION)
})
