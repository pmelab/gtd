import { Then, When } from "quickpickle"
import assert from "node:assert"
import { readdirSync } from "node:fs"
import { stateDirectory } from "../../../../src/supervisor/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

// A 'single-quoted' part is one word.
const words = (command: string): string[] => {
  const [gtd, ...args] = (command.match(/'[^']*'|\S+/g) ?? []).map((word) =>
    word.startsWith("'") ? word.slice(1, -1) : word,
  )
  assert.strictEqual(gtd, "gtd", `not a gtd command: ${command}`)
  return args
}

const socketModes = new WeakMap<GtdWorld, number>()

// `<HEAD of portal/plan>` stands for that worktree's HEAD commit.
When("I run {string} in the workspace", async (world: GtdWorld, command: string) => {
  const b = bench(world)
  let line = command
  for (const [placeholder, ref] of command.matchAll(/<HEAD of ([^>]+)>/g)) {
    const [project] = ref!.split("/") as [string]
    const path = await b.pathOf(ref!)
    const head = (await b.worktrees.adapter.list(project)).find((w) => w.path === path)!.head
    line = line.replace(placeholder, head)
  }
  await b.command(words(line))
})

When(
  "I send SIGTERM to a spawned gtd workspace, first running {string}",
  async (world: GtdWorld, command: string) => {
    const b = bench(world)
    const env = world.spawnEnv()
    await b.spawnAndSignal(world.gtdBin, env, "SIGTERM", async () => {
      socketModes.set(world, b.socketMode())
      b.lastCommand = await b.spawnGtd(world.gtdBin, env, words(command))
    })
    const { code, signal } = b.lastSignal!
    world.lastSignalExit = {
      code,
      signal,
      status: signal === "SIGTERM" ? 143 : (code ?? -1),
    }
  },
)

Then("the command exits {int}", (world: GtdWorld, code: number) => {
  const run = bench(world).lastCommand
  assert.strictEqual(run?.exitCode, code, run?.stderr)
})

const exitsPrinting = (
  world: GtdWorld,
  code: number,
  expected: string,
  run = bench(world).lastCommand,
) => {
  assert.strictEqual(run?.exitCode, code, run?.stderr)
  assert.ok(run.stderr.includes(expected.trim()), `stderr was:\n${run.stderr}`)
}

Then("the command exits {int}, printing:", exitsPrinting)

Then("the command run beside the supervisor exited {int}, printing:", exitsPrinting)

Then("the supervisor's socket had the mode 0600 while it served", (world: GtdWorld) => {
  assert.strictEqual(socketModes.get(world)?.toString(8), "600")
})

Then("the supervisor's state directory holds no socket", (world: GtdWorld) => {
  const b = bench(world)
  assert.ok(!readdirSync(stateDirectory(b.stateHome, b.root)).includes("socket"))
})
