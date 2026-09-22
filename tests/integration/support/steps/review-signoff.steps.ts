import { When } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// Actually executes a check-actor state's rendered script against the real
// repo — the piece a driver performs (`sh -c "$content"`, exit code ignored)
// before capturing the outcome via `gtd land`. Reads `content` from the last
// `gtd status --json` result, so a scenario composes it as: `gtd status
// --json` -> this step -> `gtd land`. @live only: the bug class this exists
// to catch (issue #128) lives in the script's own shell logic, which @inmem
// never runs (see AGENTS.md, review-feedback-guards.feature).
When("I execute the printed check script", async (world: GtdWorld) => {
  assert.strictEqual(world.tier, "live", "executing a rendered script requires an @live scenario")
  const { content } = JSON.parse(world.lastResult.stdout) as { content: string }
  // Exit code is deliberately ignored, exactly like a driver's own `|| true`
  // — the script encodes its outcome in the tree, not its exit status.
  await world.runScriptWithSh(content)
})
