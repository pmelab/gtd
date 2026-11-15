import { Given, Then, When, type DataTable } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { WorkspaceBench } from "../workspace.js"

const benches = new WeakMap<GtdWorld, WorkspaceBench>()

export const bench = (world: GtdWorld): WorkspaceBench => {
  let found = benches.get(world)
  if (found === undefined) {
    const created = new WorkspaceBench()
    world.closers.push(() => created.dispose())
    benches.set(world, created)
    found = created
  }
  return found
}

Given("a workspace file {string} with:", (world: GtdWorld, path: string, content: string) => {
  bench(world).writeFile(path, content)
})

// Each project gets its main checkout on `main`; a row naming `main` adds nothing else.
Given("the worktrees adapter reports these worktrees:", (world: GtdWorld, table: DataTable) => {
  const { root, worktrees } = bench(world)
  const known = new Set<string>()
  for (const { project, branch } of table.hashes() as { project: string; branch: string }[]) {
    if (!known.has(project)) worktrees.addProject(project, `${root}/${project}`)
    known.add(project)
    if (branch !== "main") worktrees.addWorktree(project, branch)
  }
})

Given(
  "gtd next --json in {string} prints:",
  async (world: GtdWorld, ref: string, stdout: string) => {
    const b = bench(world)
    b.answer(await b.pathOf(ref), { status: 0, stdout, stderr: "" })
  },
)

Given("gtd next in {string} fails with:", async (world: GtdWorld, ref: string, stderr: string) => {
  const b = bench(world)
  b.answer(await b.pathOf(ref), { status: 1, stdout: "", stderr })
})

When("I start gtd workspace", async (world: GtdWorld) => {
  await bench(world).start()
})

When("I start gtd workspace with {string}", async (world: GtdWorld, args: string) => {
  await bench(world).start(...args.split(/\s+/))
})

When("I stop gtd workspace", async (world: GtdWorld) => {
  await bench(world).stopAll()
})

When("I send SIGTERM to a spawned gtd workspace", async (world: GtdWorld) => {
  const b = bench(world)
  await b.spawnAndSignal(world.gtdBin, world.spawnEnv(), "SIGTERM")
  const { code, signal } = b.lastSignal!
  world.lastSignalExit = { code, signal, status: signal === "SIGTERM" ? 143 : (code ?? -1) }
})

Then("gtd workspace serves", async (world: GtdWorld) => {
  const b = bench(world)
  assert.strictEqual(b.lastRun, undefined, `it exited: ${b.lastRun?.stderr}`)
  assert.strictEqual((await b.request("/")).status, 200)
})

Then("gtd workspace exits {int}, printing:", (world: GtdWorld, code: number, expected: string) => {
  const run = bench(world).lastRun
  assert.ok(run !== undefined, "gtd workspace is still running")
  assert.strictEqual(run.exitCode, code, run.stderr)
  assert.ok(run.stderr.includes(expected.trim()), `stderr was:\n${run.stderr}`)
})

Then("gtd workspace exits 1, naming the running supervisor's pid and URL", (world: GtdWorld) => {
  const b = bench(world)
  const run = b.lastRun
  assert.ok(run !== undefined, "the second gtd workspace is still running")
  assert.strictEqual(run.exitCode, 1, run.stderr)
  assert.ok(run.stderr.includes(`pid ${process.pid}`), run.stderr)
  assert.ok(b.firstUrl !== undefined && run.stderr.includes(b.firstUrl), run.stderr)
})

const statusText = (w: { status: string; errorKind?: string; kind?: string }): string => {
  const kind = w.errorKind ?? w.kind
  return kind === undefined ? w.status : `${w.status} (${kind})`
}

Then("the Projects view lists:", async (world: GtdWorld, table: DataTable) => {
  const rows = (await bench(world).projects()).flatMap((project) =>
    project.worktrees.map((w) => ({
      project: project.name,
      worktree: w.branch ?? w.path,
      status: statusText(w),
      label: [w.label, w.message].filter(Boolean).join(" — "),
    })),
  )
  assert.deepStrictEqual(rows, table.hashes())
})

/** The page's headings and list items, one per line, tags stripped. */
Then("the dashboard page reads:", async (world: GtdWorld, expected: string) => {
  const html = await (await bench(world).request("/")).text()
  const lines = [...html.matchAll(/<(h1|h2|li|p)[^>]*>(.*?)<\/\1>/g)].map(([, , inner]) =>
    inner!
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  )
  assert.strictEqual(lines.join("\n"), expected.trim())
})

When("{string} requests the dashboard", async (world: GtdWorld, login: string) => {
  await bench(world).request("/", login)
})

Then("the dashboard answers {int}", (world: GtdWorld, status: number) => {
  assert.strictEqual(bench(world).lastStatus, status)
})

Then("no supervisor lock is left", (world: GtdWorld) => {
  assert.strictEqual(bench(world).lockExists(), false)
})
