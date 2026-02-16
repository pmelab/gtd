import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService } from "../services/Agent.js"
import { interpolate } from "../prompts/index.js"
import { generateCommitMessage } from "../services/CommitMessage.js"
import { createSpinnerRenderer, isInteractive } from "../services/Renderer.js"

export const commitFeedbackCommand = () =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService
    const agent = yield* AgentService

    const renderer = createSpinnerRenderer(isInteractive())

    yield* Effect.gen(function* () {
      renderer.setText("Classifying changes…")

      const diff = yield* git.getDiff()

      const prompt = interpolate(config.commitPrompt, { diff })

      renderer.setText("Generating feedback…")

      yield* agent.invoke({
        prompt,
        systemPrompt: "",
        mode: "plan",
        cwd: process.cwd(),
        onEvent: renderer.onEvent,
      })

      renderer.setText("Committing feedback…")

      const commitMessage = yield* generateCommitMessage("🤦", diff)

      yield* git.atomicCommit("all", commitMessage)

      renderer.succeed("Feedback committed.")
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          renderer.fail("Commit feedback failed.")
        }),
      ),
    )
  })
