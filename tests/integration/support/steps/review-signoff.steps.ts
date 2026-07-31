import { When } from "quickpickle"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

const execFile = promisify(execFileCb)

// Actually executes a check-actor state's rendered script against the real
// repo — the piece bin/gtd's own loop driver performs (`bash -c "$content"`,
// exit code ignored) before capturing the outcome via `gtd step <actor>`. Reads
// `content` from the last `gtd next --json` result, so a scenario composes it
// as: `gtd next --json` -> this step -> `gtd step check`. @live only: the bug
// class this exists to catch (issue #128) lives in the script's own shell
// logic, which @inmem never runs (see AGENTS.md, review-feedback-guards.feature).
When("I execute the printed check script", async (world: GtdWorld) => {
  assert.strictEqual(world.tier, "live", "executing a rendered script requires an @live scenario")
  const { content } = JSON.parse(world.lastResult.stdout) as { content: string }
  try {
    await execFile("bash", ["-c", content], { cwd: world.repoDir })
  } catch {
    // Exit code is deliberately ignored, exactly like bin/gtd's own `|| true`
    // — the script encodes its outcome in the tree, not its exit status.
  }
})
