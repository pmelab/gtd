import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService, catchAgentError } from "../services/Agent.js"
import { explorePrompt, interpolate } from "../prompts/index.js"
import { generateCommitMessage } from "../services/CommitMessage.js"
import { createSpinnerRenderer, isInteractive } from "../services/Renderer.js"
import { notify } from "../services/Notify.js"
import { nodeFileOps, type FileOps } from "../services/FileOps.js"

export const exploreCommand = (fs: Pick<FileOps, "exists" | "readFile" | "getDiffContent">) =>
  Effect.gen(function* () {
    const git = yield* GitService
    const agent = yield* AgentService

    const renderer = createSpinnerRenderer(isInteractive())

    // Read seed content from TODO.md
    const fileExists = yield* fs.exists()
    const seed = fileExists ? yield* fs.readFile() : ""

    // Get diff (fall back to HEAD commit when working tree is clean)
    let diff = yield* git.getDiff()
    if (diff.trim() === "") {
      diff = yield* git.show("HEAD").pipe(Effect.catchAll(() => Effect.succeed("")))
    }

    const diffSection =
      diff.trim() !== ""
        ? `### User Edits (diff)\n\n\`\`\`diff\n${diff}\n\`\`\``
        : ""

    const prompt = interpolate(explorePrompt, {
      seed,
      diff: diffSection,
    })

    renderer.setText("Exploring approaches...")
    yield* agent
      .invoke({
        prompt,
        systemPrompt: "",
        mode: "explore",
        cwd: process.cwd(),
        onEvent: renderer.onEvent,
      })
      .pipe(Effect.ensuring(Effect.sync(() => renderer.dispose())))

    const hasChanges = yield* git.hasUncommittedChanges()
    if (hasChanges) {
      const exploreDiff = yield* git.getDiff()
      const exploreCommitMessage = yield* generateCommitMessage("🧭", exploreDiff)
      yield* git.atomicCommit("all", exploreCommitMessage)
      renderer.succeed("Exploration committed.")
    } else {
      yield* git.emptyCommit("🧭 explore: no changes")
      renderer.succeed("Exploration unchanged, empty commit to advance state.")
    }

    yield* notify("gtd", "Exploration committed.")
  }).pipe(catchAgentError)

export const makeExploreCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  return yield* exploreCommand(yield* nodeFileOps(config.file))
})
