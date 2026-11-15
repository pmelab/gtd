import { Given, Then, When, type DataTable } from "quickpickle"
import assert from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { stateDirectory } from "../../../../src/supervisor/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

interface Pressed {
  readonly status: number
  readonly message?: string
}

const presses = new WeakMap<GtdWorld, Pressed>()

/** Presses the button with the HEAD commit the dashboard shows, as the page does. */
const press = async (world: GtdWorld, button: string, ref: string): Promise<Pressed> => {
  const b = bench(world)
  const path = await b.pathOf(ref)
  const view = (await b.projects()).flatMap((p) => p.worktrees).find((w) => w.path === path)
  assert.ok(view !== undefined, `the dashboard does not show ${ref}`)
  const response = await b.post(`/trpc/${button.toLowerCase()}`, {
    worktree: path,
    commit: view.head,
  })
  const body = (await response.json()) as { error?: { message: string } }
  return {
    status: response.status,
    ...(body.error !== undefined ? { message: body.error.message } : {}),
  }
}

When(
  /^I press (Proceed|Retry) on "([^"]+)"$/,
  async (world: GtdWorld, button: string, ref: string) => {
    presses.set(world, await press(world, button, ref))
  },
)

When(
  /^I press (Proceed|Retry) on "([^"]+)" while (\d+) seconds pass$/,
  async (world: GtdWorld, button: string, ref: string, seconds: string) => {
    const b = bench(world)
    const pressing = press(world, button, ref)
    await b.clock.advance(Number(seconds) * 1000)
    presses.set(world, await pressing)
  },
)

Then("gtd accepts the press", (world: GtdWorld) => {
  const pressed = presses.get(world)
  assert.strictEqual(pressed?.status, 200, pressed?.message)
})

Then("gtd refuses the press with {string}", (world: GtdWorld, message: string) => {
  assert.deepStrictEqual(presses.get(world), { status: 409, message })
})

Given(
  "the driver in {string} refuses one-shots with:",
  async (world: GtdWorld, ref: string, stderr: string) => {
    const b = bench(world)
    b.refusing.set(await b.pathOf(ref), `${stderr}\n`)
  },
)

Given(
  "the driver in {string} never answers its one-shots",
  async (world: GtdWorld, ref: string) => {
    const b = bench(world)
    b.silent.add(await b.pathOf(ref))
  },
)

// The commit in an argv shows as <HEAD> when it is the worktree's HEAD.
Then("the driver one-shots ran:", async (world: GtdWorld, table: DataTable) => {
  const b = bench(world)
  const heads = new Map(
    (await b.projects()).flatMap((p) => p.worktrees).map((w) => [w.path, w.head]),
  )
  const ran = await Promise.all(
    b.oneShots.map(async ({ worktree, argv }) => ({
      worktree: await b.refOf(worktree),
      argv: argv.map((arg) => (arg === heads.get(worktree) ? "<HEAD>" : arg)).join(" "),
    })),
  )
  assert.deepStrictEqual(ran, table.hashes())
})

Then(
  "the Projects view shows the refusal on {string}:",
  async (world: GtdWorld, ref: string, message: string) => {
    const b = bench(world)
    const path = await b.pathOf(ref)
    const view = (await b.projects()).flatMap((p) => p.worktrees).find((w) => w.path === path)
    assert.strictEqual(view?.refusal, message.trim())
  },
)

Then("the audit log reads:", (world: GtdWorld, table: DataTable) => {
  const b = bench(world)
  const file = join(stateDirectory(b.stateHome, b.root), "audit.log")
  const columns: readonly string[] = table.raw()[0]!
  const lines = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, string>)
    .map((entry) => Object.fromEntries(columns.map((c) => [c, entry[c] ?? ""])))
  assert.deepStrictEqual(lines, table.hashes())
})
