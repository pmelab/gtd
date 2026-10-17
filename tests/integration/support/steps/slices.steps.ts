import { Then } from "quickpickle"
import assert from "node:assert"
import { Effect } from "effect"
import { currentRest } from "../../../../src/edge/index.js"
import { testLayers } from "../../../../src/testkit/index.js"
import type { GtdWorld } from "../world.js"

// One block per slice: `<name> (open|closed)`, then the subjects of its
// base..tip commits, oldest first, indented. In memory only — slices have no
// CLI surface, so the step reads them off the current rest.
Then("the slices are:", async (world: GtdWorld, doc: string) => {
  const repo = world.repo!
  const rest = await Effect.runPromise(
    currentRest.pipe(Effect.provide(testLayers(repo, { env: world.envVars }))),
  )
  const actual = rest.slices
    .map((slice) => {
      const subjects = repo
        .commitHistory(slice.base, slice.tip)
        .map((c) => `  ${c.message.split("\n")[0] ?? ""}`)
      return [`${slice.name} (${slice.open ? "open" : "closed"})`, ...subjects].join("\n")
    })
    .join("\n")
  assert.strictEqual(
    actual,
    doc.trim(),
    `Slices mismatch.\nExpected:\n${doc.trim()}\nActual:\n${actual}`,
  )
})
