import { When } from "quickpickle"
import type { GtdWorld } from "../world.js"

// Executes a check-actor state's rendered script — the piece a driver
// performs (`sh -c "$content"`, exit code ignored) before capturing the
// outcome via `gtd land`. Reads `content` from the last `gtd next --json`
// result, so a scenario composes it as: `gtd next --json` -> this step ->
// `gtd land`.
When("I execute the printed check script", async (world: GtdWorld) => {
  const { content } = JSON.parse(world.lastResult.stdout) as { content: string }
  // Exit code is deliberately ignored, exactly like a driver's own `|| true`
  // — the script encodes its outcome in the tree, not its exit status.
  await world.runEmittedScript(content)
})
