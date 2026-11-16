import { Given, Then, When } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

// `<project>/<branch>`; a branch may hold a "/".
const split = (ref: string): [string, string] => {
  const slash = ref.indexOf("/")
  return [ref.slice(0, slash), ref.slice(slash + 1)]
}

const INTEGRATED: Readonly<Record<string, boolean | undefined>> = {
  true: true,
  false: false,
  unknown: undefined,
}

// `true`, `false`, or `unknown` for an adapter that cannot tell.
Given(
  "the worktrees adapter reports {string} as integrated: {word}",
  (world: GtdWorld, ref: string, value: string) => {
    if (!(value in INTEGRATED)) throw new Error(`integrated is true, false or unknown: ${value}`)
    bench(world).worktrees.reportIntegrated(...split(ref), INTEGRATED[value])
  },
)

Given(
  "the main checkout of {string} does not refresh:",
  (world: GtdWorld, project: string, reason: string) => {
    bench(world).worktrees.stale(project, reason.trim())
  },
)

When("the main checkout of {string} refreshes again", (world: GtdWorld, project: string) => {
  bench(world).worktrees.stale(project, undefined)
})

// An empty docstring: the project's main checkout is not marked stale.
Then(
  "the Projects view marks the main checkout of {string} stale with:",
  async (world: GtdWorld, project: string, reason: string) => {
    const view = (await bench(world).projects()).find((p) => p.id === project)
    assert.strictEqual(view?.mainStale ?? "", reason.trim())
  },
)
