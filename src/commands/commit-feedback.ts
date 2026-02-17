import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService } from "../services/Agent.js"
import { interpolate } from "../prompts/index.js"
import { generateCommitMessage } from "../services/CommitMessage.js"
import { classifyDiff } from "../services/DiffClassifier.js"
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
      const { fixes, seed, feedback, humanTodos } = classifyDiff(diff, config.file)

      const prompt = interpolate(config.commitPrompt, { diff })

      renderer.setText("Generating feedback…")

      yield* agent.invoke({
        prompt,
        systemPrompt: "",
        mode: "plan",
        cwd: process.cwd(),
        onEvent: renderer.onEvent,
      })

      const parts: Array<{ prefix: string; diff: string; useStage: boolean }> = []

      if (fixes) parts.push({ prefix: "👷", diff: fixes, useStage: true })
      if (seed) parts.push({ prefix: "🌱", diff: seed, useStage: true })
      if (feedback) parts.push({ prefix: "💬", diff: feedback, useStage: true })
      if (humanTodos) parts.push({ prefix: "🤦", diff: humanTodos, useStage: true })

      if (parts.length === 0) {
        renderer.setText("Committing feedback…")
        const msg = yield* generateCommitMessage("🤦", diff)
        yield* git.atomicCommit("all", msg)
      } else if (parts.length === 1) {
        renderer.setText("Committing feedback…")
        const part = parts[0]!
        const msg = yield* generateCommitMessage(part.prefix, part.diff)
        yield* git.atomicCommit("all", msg)
      } else {
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i]!
          const isLast = i === parts.length - 1
          renderer.setText(`Committing ${part.prefix}…`)
          const msg = yield* generateCommitMessage(part.prefix, part.diff)
          if (isLast) {
            yield* git.atomicCommit("all", msg)
          } else {
            yield* git.stageByPatch(part.diff)
            yield* git.commit(msg)
          }
        }
      }

      renderer.succeed("Feedback committed.")
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          renderer.fail("Commit feedback failed.")
        }),
      ),
    )
  })
