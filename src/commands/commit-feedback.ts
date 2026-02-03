import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService } from "../services/Agent.js"
import { interpolate } from "../prompts/index.js"

export const commitFeedbackCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  const git = yield* GitService
  const agent = yield* AgentService

  const diff = yield* git.getDiff()

  const prompt = interpolate(config.commitPrompt, { diff })

  yield* agent.invoke({
    prompt,
    systemPrompt: "",
    mode: "plan",
    cwd: process.cwd(),
  })

  const summary = diff
    .split("\n")
    .filter((l) => l.startsWith("diff --git") || l.startsWith("+++ ") || l.startsWith("--- "))
    .map((l) => l.replace(/^diff --git a\//, "").replace(/ b\/.*/, ""))
    .filter((l) => !l.startsWith("---") && !l.startsWith("+++"))
    .join(", ")

  const shortSummary = summary.length > 0 ? summary.slice(0, 72) : "human feedback"

  yield* git.atomicCommit("all", `🤦 ${shortSummary}`)
})
