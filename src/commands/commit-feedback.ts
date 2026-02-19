import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService } from "../services/Agent.js"
import { interpolate } from "../prompts/index.js"
import { generateCommitMessage } from "../services/CommitMessage.js"
import { classifyDiff } from "../services/DiffClassifier.js"
import { SEED, FEEDBACK, HUMAN, FIX, type CommitPrefix } from "../services/CommitPrefix.js"
import { createSpinnerRenderer, isInteractive } from "../services/Renderer.js"
import { findNewlyAddedTodos, removeTodoLines } from "../services/TodoRemover.js"

export const commitFeedbackCommand = () =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService
    const agent = yield* AgentService

    const renderer = createSpinnerRenderer(isInteractive())

    yield* Effect.gen(function* () {
      renderer.setText("Classifying changes…")

      const diff = yield* git.getDiff()
      const classified = classifyDiff(diff, config.file)

      const categories: Array<{ prefix: CommitPrefix; patch: string }> = []
      if (classified.seed) categories.push({ prefix: SEED, patch: classified.seed })
      if (classified.humanTodos) categories.push({ prefix: HUMAN, patch: classified.humanTodos })
      if (classified.fixes) categories.push({ prefix: FIX, patch: classified.fixes })
      if (classified.feedback) categories.push({ prefix: FEEDBACK, patch: classified.feedback })

      if (categories.length === 0) {
        categories.push({ prefix: HUMAN, patch: diff })
      }

      for (const { prefix, patch } of categories) {
        if (prefix !== FIX) {
          const prompt = interpolate(config.commitPrompt, { diff: patch })

          renderer.setText("Generating feedback…")

          yield* agent.invoke({
            prompt,
            systemPrompt: "",
            mode: "plan",
            cwd: process.cwd(),
            onEvent: renderer.onEvent,
          })
        }

        renderer.setText("Committing feedback…")
        const msg = yield* generateCommitMessage(prefix, patch)

        if (categories.length === 1) {
          yield* git.atomicCommit("all", msg)
        } else {
          yield* git.stageByPatch(patch)
          yield* git.commit(msg)
        }
      }

      // Remove newly-added in-code TODO/FIXME comments from source files,
      // leaving changes unstaged so the plan step picks them up
      if (classified.humanTodos) {
        const todos = findNewlyAddedTodos(classified.humanTodos, config.file)
        if (todos.length > 0) {
          yield* removeTodoLines(todos, process.cwd()).pipe(
            Effect.catchAll(() => Effect.succeed(0)),
          )
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
