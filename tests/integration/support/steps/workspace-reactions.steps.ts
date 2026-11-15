import { Then } from "quickpickle"
import assert from "node:assert"
import { settle } from "../../../../src/twins/index.js"
import type { GtdWorld } from "../world.js"
import { bench } from "./workspace.steps.js"

// What reactions passed to `ctx.log`, from every supervisor of the scenario.
// `<HEAD of portal/plan>` stands for that worktree's HEAD commit.
Then("the reactions logged:", async (world: GtdWorld, expected: string) => {
  const b = bench(world)
  await settle()
  let text = expected.trim()
  for (const [placeholder, ref] of text.matchAll(/<HEAD of ([^>]+)>/g)) {
    const [project] = ref!.split("/") as [string]
    const path = await b.pathOf(ref!)
    const head = (await b.worktrees.adapter.list(project)).find((w) => w.path === path)!.head
    text = text.replace(placeholder, head)
  }
  const logged = b.allOutput.split("\n").filter((line) => /^reaction [^ ]+: /.test(line))
  assert.deepStrictEqual(logged, text === "" ? [] : text.split("\n"))
})
