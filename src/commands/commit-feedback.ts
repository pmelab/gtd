import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService } from "../services/Agent.js"
import { interpolate } from "../prompts/index.js"
import { generateCommitMessage } from "../services/CommitMessage.js"

export const commitFeedbackCommand = () =>
  Effect.gen(function* () {
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

    const commitMessage = yield* generateCommitMessage("🤦", diff)

    yield* git.atomicCommit("all", commitMessage)

    console.log("Feedback committed.")
  })
