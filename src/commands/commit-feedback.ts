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

      for (let i = 0; i < categories.length; i++) {
        const { prefix, patch } = categories[i]!
        const isLast = i === categories.length - 1

        // Invoke agent for HUMAN only — SEED/FEEDBACK are handled by plan, FIX needs no processing
        if (prefix === HUMAN) {
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

        // Remove newly-added in-code TODO/FIXME comments before committing so the
        // removals are included in this or the final commit rather than left unstaged
        if (prefix === HUMAN && classified.humanTodos) {
          const todos = findNewlyAddedTodos(classified.humanTodos, config.file)
          if (todos.length > 0) {
            yield* removeTodoLines(todos, process.cwd()).pipe(
              Effect.catchAll(() => Effect.succeed(0)),
            )
          }
        }

        renderer.setText("Committing feedback…")
        const msg = yield* generateCommitMessage(prefix, patch)

        if (isLast) {
          // Last commit captures agent file modifications and removeTodoLines changes
          yield* git.atomicCommit("all", msg)
        } else {
          yield* git.stageByPatch(patch)
          yield* git.commit(msg)
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
