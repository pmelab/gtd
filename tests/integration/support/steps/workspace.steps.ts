import { Given, Then, When, type DataTable } from "quickpickle"
import assert from "node:assert"
import { join } from "node:path"
import { parseRawRequest, type GtdWorld } from "../world.js"
import { settle } from "../../../../src/twins/index.js"
import { WorkspaceBench } from "../workspace.js"
import { durationMs, type Duration } from "../../../../src/workspace/index.js"

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
  for (const { project, branch } of table.hashes() as {
    project: string
    branch: string
  }[]) {
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

When("the .gtd files of {string} change", async (world: GtdWorld, ref: string) => {
  const b = bench(world)
  const path = await b.pathOf(ref)
  b.prints.set(path, `${b.prints.get(path) ?? ""}x`)
})

When("I start gtd workspace", async (world: GtdWorld) => {
  await bench(world).start()
})

When("I start gtd workspace with {string}", async (world: GtdWorld, args: string) => {
  await bench(world).start(...args.split(/\s+/))
})

Then(
  "the supervisors printed {string} {int} time(s)",
  (world: GtdWorld, text: string, times: number) => {
    const output = bench(world).allOutput
    assert.strictEqual(output.split(text).length - 1, times, output)
  },
)

When("I stop gtd workspace", async (world: GtdWorld) => {
  await bench(world).stopAll()
})

When("I send SIGTERM to a spawned gtd workspace", async (world: GtdWorld) => {
  const b = bench(world)
  await b.spawnAndSignal(world.gtdBin, world.spawnEnv(), "SIGTERM")
  const { code, signal } = b.lastSignal!
  world.lastSignalExit = {
    code,
    signal,
    status: signal === "SIGTERM" ? 143 : (code ?? -1),
  }
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

Then(
  "the Projects view flags these worktrees as at a human gate:",
  async (world: GtdWorld, table: DataTable) => {
    const rows = (await bench(world).projects()).flatMap((project) =>
      project.worktrees.map((w) => ({
        project: project.name,
        worktree: w.branch ?? w.path,
        humanRest: String(w.humanRest === true),
      })),
    )
    assert.deepStrictEqual(rows, table.hashes())
  },
)

Given("the command {string} prints:", (world: GtdWorld, argv: string, stdout: string) => {
  bench(world).commands.set(argv, { status: 0, stdout, stderr: "" })
})

When("the clock advances {string}", async (world: GtdWorld, duration: string) => {
  await bench(world).advance(durationMs(duration as Duration))
})

When("I dismiss {string} in the Inbox", async (world: GtdWorld, ref: string) => {
  const [feed, key] = ref.split("/") as [string, string]
  const response = await bench(world).post("/trpc/dismiss", { feed, key })
  assert.strictEqual(response.status, 200, await response.text())
})

Then("the Inbox lists:", async (world: GtdWorld, table: DataTable) => {
  const { items } = await bench(world).inbox()
  // Compares the columns the table has, such as `message`.
  const columns: readonly string[] = table.raw()[0] ?? []
  const { root } = bench(world)
  const expected = table
    .hashes()
    .map((row: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(row as Record<string, string>).map(([k, v]) => [
          k,
          v.replaceAll("{root}", root),
        ]),
      ),
    )
  assert.deepStrictEqual(
    items.map((item) =>
      Object.fromEntries(
        columns.map((column) => [
          column,
          (item as unknown as Record<string, string | undefined>)[column] ?? "",
        ]),
      ),
    ),
    expected,
  )
})

Then("the Inbox reports these feeds:", async (world: GtdWorld, table: DataTable) => {
  const { feeds } = await bench(world).inbox()
  assert.deepStrictEqual(
    feeds.map(({ feed, project, mode, failing }) => ({
      feed,
      project,
      mode,
      failing: failing ?? "",
    })),
    table.hashes(),
  )
})

Then("the workspace directory holds only {string}", (world: GtdWorld, name: string) => {
  assert.deepStrictEqual(bench(world).rootEntries(), [name])
})

When("I delete the supervisor's state directory", (world: GtdWorld) => {
  bench(world).deleteState()
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

// ── gate pages ──

Given(
  "the file {string} in {string} reads:",
  async (world: GtdWorld, path: string, ref: string, content: string) => {
    const b = bench(world)
    b.files.set(join(await b.pathOf(ref), path), `${content}\n`)
  },
)

const gateOf = async (b: WorkspaceBench, ref: string): Promise<string> => {
  const path = await b.pathOf(ref)
  const found = (await b.projects()).flatMap((p) => p.worktrees).find((w) => w.path === path)
  assert.ok(found !== undefined, `the Projects view does not list ${ref}`)
  return found.gate
}

Then("the Projects view links these gate pages:", async (world: GtdWorld, table: DataTable) => {
  const rows = (await bench(world).projects()).flatMap((project) =>
    project.worktrees.map((w) => ({
      project: project.name,
      worktree: w.branch ?? w.path,
      gate: w.gate,
    })),
  )
  assert.deepStrictEqual(rows, table.hashes())
})

Then(
  "the Projects view shows gate kind {string} and base {string} for {string}",
  async (world: GtdWorld, kind: string, base: string, ref: string) => {
    const b = bench(world)
    const path = await b.pathOf(ref)
    const found = (await b.projects()).flatMap((p) => p.worktrees).find((w) => w.path === path)
    assert.deepStrictEqual([found?.gateKind, found?.gateBase], [kind, base])
  },
)

Then("the Projects view shows no gate kind for {string}", async (world: GtdWorld, ref: string) => {
  const b = bench(world)
  const path = await b.pathOf(ref)
  const found = (await b.projects()).flatMap((p) => p.worktrees).find((w) => w.path === path)
  assert.deepStrictEqual([found?.gateKind, found?.gateBase], [undefined, undefined])
})

Then("every listed gate page answers {int}", async (world: GtdWorld, status: number) => {
  const b = bench(world)
  for (const w of (await b.projects()).flatMap((p) => p.worktrees)) {
    const response = await b.request(w.gate)
    assert.strictEqual(response.status, status, w.gate)
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/, w.gate)
  }
})

Then(
  "the gate page of {string} shows the rest {string}",
  async (world: GtdWorld, ref: string, label: string) => {
    const b = bench(world)
    const step = await b.gateClient(await gateOf(b, ref)).step.query()
    assert.strictEqual(step.status === "ok" ? step.label : step.status, label)
  },
)

When(
  "{string} sends this request to gtd workspace:",
  async (world: GtdWorld, login: string, raw: string) => {
    const { path, ...init } = parseRawRequest(raw)
    await bench(world).request(path, login, init)
  },
)

Then("gtd workspace answers {int}", (world: GtdWorld, status: number) => {
  assert.strictEqual(bench(world).lastStatus, status)
})

const savedAt = new WeakMap<GtdWorld, number>()

When(
  "I save the note {string} through the gate page of {string}",
  async (world: GtdWorld, text: string, ref: string) => {
    const b = bench(world)
    const client = b.gateClient(await gateOf(b, ref))
    const step = await client.step.query()
    assert.ok(step.status === "ok" && step.file !== undefined, `no steering file: ${step.status}`)
    const read = await client.readSteeringFile.query({ filePath: step.file })
    savedAt.set(world, b.nextRuns.length)
    await client.writeNote.mutate({
      filePath: step.file,
      expectedHeadSha: read.headSha,
      expectedContentHash: read.contentHash,
      anchor: { kind: "paragraph", line: 0 },
      text,
    })
  },
)

When("I press Proceed through the gate page of {string}", async (world: GtdWorld, ref: string) => {
  const b = bench(world)
  const path = await b.pathOf(ref)
  const view = (await b.projects()).flatMap((p) => p.worktrees).find((w) => w.path === path)
  assert.ok(view !== undefined, `the dashboard does not show ${ref}`)
  await b.gateClient(await gateOf(b, ref)).proceed.mutate({ commit: view.head })
})

Then(
  "the file {string} in {string} contains {string}",
  async (world: GtdWorld, path: string, ref: string, text: string) => {
    const b = bench(world)
    const content = b.files.get(join(await b.pathOf(ref), path)) ?? ""
    assert.ok(content.includes(text), content)
  },
)

Then(
  "gtd next has run in {string} since the note was saved",
  async (world: GtdWorld, ref: string) => {
    const b = bench(world)
    const path = await b.pathOf(ref)
    await settle()
    const since = b.nextRuns.slice(savedAt.get(world) ?? 0)
    assert.ok(since.includes(path), `gtd next ran in: ${since.join(", ") || "nothing"}`)
  },
)

// ── change detection ──

const worktreeView = async (b: WorkspaceBench, ref: string) => {
  const [project, branch] = ref.split("/")
  return (await b.projects())
    .filter((p) => p.id === project)
    .flatMap((p) => p.worktrees)
    .find((w) => w.branch === branch)
}

const split = (ref: string): [string, string] => ref.split("/") as [string, string]

Given("the worktrees adapter has no watch", (world: GtdWorld) => {
  bench(world).watching = false
})

Given("the worktrees adapter has no unpushed", (world: GtdWorld) => {
  bench(world).unpushedOffered = false
})

When("a commit lands on {string}", (world: GtdWorld, ref: string) => {
  bench(world).worktrees.commit(...split(ref))
})

When("the worktrees adapter adds the worktree {string}", (world: GtdWorld, ref: string) => {
  bench(world).worktrees.addWorktree(...split(ref))
})

When("the worktrees adapter's watch stream ends", (world: GtdWorld) => {
  bench(world).worktrees.endWatch()
})

When(
  "the worktrees adapter fails to list {string} with:",
  (world: GtdWorld, project: string, message: string) => {
    bench(world).worktrees.failList(project, message.trim())
  },
)

When("the worktrees adapter answers again", async (world: GtdWorld) => {
  const { worktrees } = bench(world)
  for (const { id } of await worktrees.adapter.projects()) worktrees.failList(id, undefined)
})

When(/^(\d+(?:\.\d+)?) seconds? pass(?:es)?$/, async (world: GtdWorld, seconds: string) => {
  await bench(world).advance(Number(seconds) * 1000)
})

When("gtd next in {string} holds its answer", async (world: GtdWorld, ref: string) => {
  const b = bench(world)
  b.hold(await b.pathOf(ref))
})

When("gtd next in {string} gives its answer", async (world: GtdWorld, ref: string) => {
  const b = bench(world)
  await b.release(await b.pathOf(ref))
})

Then(
  /^gtd next has run (\d+) times? in "([^"]+)"$/,
  async (world: GtdWorld, times: string, ref: string) => {
    const b = bench(world)
    const path = await b.pathOf(ref)
    assert.strictEqual(b.nextRuns.filter((p) => p === path).length, Number(times))
  },
)

Then("gtd next never ran twice at once in {string}", async (world: GtdWorld, ref: string) => {
  const b = bench(world)
  assert.ok(!b.overlapped.has(await b.pathOf(ref)))
})

Then(
  "the Projects view shows {string} as {string} with {string}",
  async (world: GtdWorld, ref: string, status: string, label: string) => {
    const found = await worktreeView(bench(world), ref)
    assert.ok(found !== undefined, `the Projects view does not list ${ref}`)
    assert.deepStrictEqual([found.status, found.label], [status, label])
  },
)

Then("the Projects view does not list {string}", async (world: GtdWorld, ref: string) => {
  assert.strictEqual(await worktreeView(bench(world), ref), undefined)
})

Then("the worktrees adapter has been watched {int} times", (world: GtdWorld, times: number) => {
  assert.strictEqual(bench(world).worktrees.watched(), times)
})

Then("the dashboard shows the banner:", async (world: GtdWorld, message: string) => {
  const banners = await bench(world).banners()
  assert.deepStrictEqual(
    banners.map((b) => b.message),
    [message.trim()],
  )
})

Then("the dashboard shows no banner", async (world: GtdWorld) => {
  assert.deepStrictEqual(await bench(world).banners(), [])
})

Then("the Projects view greys no worktree", async (world: GtdWorld) => {
  const greyed = (await bench(world).projects())
    .flatMap((p) => p.worktrees)
    .filter((w) => w.unavailable !== undefined)
  assert.deepStrictEqual(greyed, [])
})
