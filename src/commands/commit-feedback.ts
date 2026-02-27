import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { generateCommitMessage } from "../services/CommitMessage.js"
import { classifyDiff } from "../services/DiffClassifier.js"
import { SEED, HUMAN, FIX, type CommitPrefix } from "../services/CommitPrefix.js"
import { createSpinnerRenderer, isInteractive } from "../services/Renderer.js"
import type { FileOps } from "../services/FileOps.js"
import { VerboseMode } from "../services/VerboseMode.js"

export const commitFeedbackCommand = (fs?: Pick<FileOps, "formatFile">) =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService

    const { isVerbose } = yield* VerboseMode
    const renderer = createSpinnerRenderer(isInteractive(), isVerbose)

    yield* Effect.gen(function* () {
      if (fs?.formatFile) {
        yield* fs.formatFile().pipe(Effect.catchAll(() => Effect.void))
      }

      renderer.setText("Classifying changes…")

      const diff = yield* git.getDiff()
      const classified = classifyDiff(diff, config.file)

      const categories: Array<{ prefix: CommitPrefix; patch: string }> = []
      if (classified.seed) categories.push({ prefix: SEED, patch: classified.seed })
      if (classified.fixes) categories.push({ prefix: FIX, patch: classified.fixes })
      if (classified.humanTodos && classified.feedback) {
        categories.push({ prefix: HUMAN, patch: classified.humanTodos + "\n" + classified.feedback })
      } else {
        if (classified.humanTodos) categories.push({ prefix: HUMAN, patch: classified.humanTodos })
        if (classified.feedback) categories.push({ prefix: HUMAN, patch: classified.feedback })
      }

      if (categories.length === 0) {
        categories.push({ prefix: HUMAN, patch: diff })
      }

      for (let i = 0; i < categories.length; i++) {
        const { prefix, patch } = categories[i]!
        const isLast = i === categories.length - 1

        renderer.setTextWithCursor("Generating commit message…")
        const msg = yield* generateCommitMessage(prefix, patch, {
          onStop: () => renderer.stopCursor(),
        })

        renderer.setText("Committing…")
        if (isLast) {
          yield* git.atomicCommit("all", msg)
        } else {
          yield* git.stageByPatch(patch)
          yield* git.commit(msg)
        }
      }

      renderer.dispose()
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          renderer.fail("Commit feedback failed.")
        }),
      ),
    )
  })
