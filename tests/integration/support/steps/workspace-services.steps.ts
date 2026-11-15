import { Given, Then, type DataTable } from "quickpickle"
import assert from "node:assert"
import type { Service } from "../../../../src/workspace/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

interface ChipRow {
  readonly worktree: string
  readonly service: string
  readonly url: string
  readonly running: string
  readonly error: string
}

Given("the services adapter reports these services:", async (world: GtdWorld, table: DataTable) => {
  const b = bench(world)
  for (const row of table.hashes() as unknown as ChipRow[]) {
    b.services.report(await b.pathOf(row.worktree), {
      name: row.service,
      url: row.url === "" ? undefined : row.url,
      running: row.running === "yes",
      error: row.error === "" ? undefined : row.error,
    })
  }
})

Given("the services adapter fails with {string}", (world: GtdWorld, message: string) => {
  bench(world).services.unavailable(message)
})

const blank = (value: string | undefined): string => value ?? ""

const chipRow = (worktree: string, s: Service): ChipRow => ({
  worktree,
  service: s.name,
  url: blank(s.url),
  running: s.running ? "yes" : "no",
  error: blank(s.error),
})

Then("the Projects view shows these service chips:", async (world: GtdWorld, table: DataTable) => {
  const rows = (await bench(world).projects()).flatMap((project) =>
    project.worktrees.flatMap((w) =>
      (w.services ?? []).map((s) => chipRow(`${project.id}/${w.branch ?? w.path}`, s)),
    ),
  )
  assert.deepStrictEqual(rows, table.hashes())
})

Then("the dashboard page links these services:", async (world: GtdWorld, table: DataTable) => {
  const html = await (await bench(world).request("/")).text()
  const links = [...html.matchAll(/<a class="service[^"]*" href="([^"]*)">(.*?)<\/a>/g)].map(
    ([, url, service]) => ({ service: service!, url: url! }),
  )
  assert.deepStrictEqual(links, table.hashes())
})
