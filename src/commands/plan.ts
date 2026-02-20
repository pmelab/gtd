import { Effect } from "effect"
import { resolve } from "node:path"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService, catchAgentError } from "../services/Agent.js"
import { detectState } from "../services/Markdown.js"
import { lint, type LintError } from "../services/Lint.js"
import { planPrompt, interpolate } from "../prompts/index.js"
import { generateCommitMessage } from "../services/CommitMessage.js"
import { createSpinnerRenderer, isInteractive } from "../services/Renderer.js"
import { notify } from "../services/Notify.js"
import { nodeFileOps, type FileOps } from "../services/FileOps.js"

const MAX_LINT_RETRIES = 3

const formatLintErrors = (errors: ReadonlyArray<LintError>): string =>
  errors.map((e) => `  Line ${e.line}: [${e.rule}] ${e.message}`).join("\n")

export const planCommand = (fs: FileOps) =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService
    const agent = yield* AgentService

    const renderer = createSpinnerRenderer(isInteractive())

    // 1. Get diff (fall back to last commit when working tree is clean)
    renderer.setText("Reading diff...")
    let diff = yield* git.getDiff()
    if (diff.trim() === "") {
      diff = yield* git.show("HEAD")
    }

    // 2. Read plan file if exists
    const fileExists = yield* fs.exists()
    const existingPlan = fileExists ? yield* fs.readFile() : ""

    // 3. Detect state and compose prompt
    const state = detectState(existingPlan)
    const filePath = resolve(process.cwd(), config.file)
    const diffSection =
      diff.trim() !== "" ? `### Git Diff\n\n\`\`\`diff\n${diff}\n\`\`\`` : "No diff available."
    const planSection =
      state !== "empty"
        ? `### Current Plan File (${filePath})\n\n\`\`\`markdown\n${existingPlan}\n\`\`\``
        : `No plan file exists yet. Create ${filePath} from scratch.`

    const prompt = interpolate(planPrompt, {
      diff: diffSection,
      plan: planSection,
    })

    // 4. Load existing session ID for continuity across plan invocations
    let previousSessionId: string | undefined
    if (fs.readSessionId) {
      previousSessionId = yield* fs.readSessionId()
    }

    // 5. Invoke agent
    renderer.setText(`Planning (state: ${state})...`)
    const planResult = yield* agent
      .invoke({
        prompt,
        systemPrompt: "",
        mode: "plan",
        cwd: process.cwd(),
        onEvent: renderer.onEvent,
        ...(previousSessionId ? { resumeSessionId: previousSessionId } : {}),
      })
      .pipe(Effect.ensuring(Effect.sync(() => renderer.dispose())))
    let sessionId = planResult.sessionId

    // 5. Lint loop
    let retries = 0
    while (retries < MAX_LINT_RETRIES) {
      const currentExists = yield* fs.exists()
      if (!currentExists) break

      const content = yield* fs.readFile()
      const errors = lint(content)
      if (errors.length === 0) break

      retries++
      if (retries >= MAX_LINT_RETRIES) {
        renderer.fail(`Lint errors remain after ${MAX_LINT_RETRIES} retries:\n${formatLintErrors(errors)}`)
        break
      }

      renderer.setText(`Fixing lint errors (attempt ${retries}/${MAX_LINT_RETRIES})...`)
      const lintResult = yield* agent
        .invoke({
          prompt: `Fix these structural issues in ${filePath}:\n\n${formatLintErrors(errors)}\n\nRead the file, fix the issues, and save it.`,
          systemPrompt: "",
          mode: "plan",
          cwd: process.cwd(),
          onEvent: renderer.onEvent,
          ...(sessionId ? { resumeSessionId: sessionId } : {}),
        })
        .pipe(Effect.ensuring(Effect.sync(() => renderer.dispose())))
      sessionId = lintResult.sessionId ?? sessionId
    }

    // 6. Format plan file with prettier
    if (fs.formatFile) {
      yield* fs.formatFile().pipe(
        Effect.catchAll((err) => {
          renderer.setText(`Prettier warning: ${err.message}`)
          return Effect.void
        }),
      )
    }

    // 7. Atomic git add + commit (or empty commit if agent made no changes)
    const hasChanges = yield* git.hasUncommittedChanges()
    if (hasChanges) {
      const planDiff = yield* git.getDiff()
      const planCommitMessage = yield* generateCommitMessage("🤖", planDiff)
      yield* git.atomicCommit("all", planCommitMessage)
      renderer.succeed("Plan committed.")
    } else {
      yield* git.emptyCommit("🤖 plan: no changes")
      renderer.succeed("Plan unchanged, empty commit to advance state.")
    }

    // 8. Save session ID for build command
    if (sessionId && fs.writeSessionId) {
      yield* fs.writeSessionId(sessionId)
    }

    yield* notify("gtd", "Plan committed.")
  }).pipe(catchAgentError)

export const makePlanCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  return yield* planCommand(yield* nodeFileOps(config.file))
})
