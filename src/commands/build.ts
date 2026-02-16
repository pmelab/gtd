import { Duration, Effect, Option } from "effect"
import { resolve } from "node:path"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService, catchAgentError } from "../services/Agent.js"
import { generateCommitMessage } from "../services/CommitMessage.js"
import {
  getNextUncheckedPackage,
  hasUncheckedItems,
  extractLearnings,
  parsePackages,
  type Package,
} from "../services/Markdown.js"
import { buildPrompt, interpolate } from "../prompts/index.js"
import { createBuildRenderer, isInteractive } from "../services/Renderer.js"
import { notify } from "../services/Notify.js"
import { bunFileOps, type FileOps } from "../services/FileOps.js"

export interface TestResult {
  readonly exitCode: number
  readonly output: string
}

export const buildCommand = (fs: FileOps) =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService
    const agent = yield* AgentService

    const exists = yield* fs.exists()
    if (!exists) {
      console.error(`[gtd] Plan file ${config.file} not found. Run "gtd plan" first.`)
      return
    }

    let content = yield* fs.readFile()
    if (!hasUncheckedItems(content)) {
      console.log(`[gtd] No unchecked items in ${config.file}. Nothing to build.`)
      return
    }

    // Parse packages upfront for renderer
    const allPackages = parsePackages(content)
    const renderer = createBuildRenderer(allPackages, isInteractive())

    const completedSummaries: string[] = []

    // Load plan session ID for first package continuity
    let planSessionId: string | undefined
    if (fs.readSessionId) {
      planSessionId = yield* fs.readSessionId()
    }

    while (true) {
      content = yield* fs.readFile()
      const nextPkg = getNextUncheckedPackage(content)
      if (Option.isNone(nextPkg)) break

      const pkg = nextPkg.value
      const learnings = extractLearnings(content)
      renderer.setStatus(pkg.title, "building")

      const planFilePath = resolve(process.cwd(), config.file)
      const itemSection = formatPackagePrompt(pkg, planFilePath)
      const learningsSection =
        learnings.trim() !== "" ? `### Learnings\n\n${learnings}` : "No learnings yet."
      const completedSection =
        completedSummaries.length > 0
          ? completedSummaries.join("\n")
          : "No previous packages completed."

      const prompt = interpolate(buildPrompt, {
        item: itemSection,
        learnings: learningsSection,
        completed: completedSection,
        testOutput: "",
      })

      const buildResult = yield* agent
        .invoke({
          prompt,
          systemPrompt: "",
          mode: "build",
          cwd: process.cwd(),
          onEvent: renderer.onEvent,
          ...(planSessionId ? { resumeSessionId: planSessionId } : {}),
        })
        .pipe(Effect.ensuring(Effect.sync(() => {})))
      const buildSessionId = buildResult.sessionId

      // Test loop
      const testFn = fs.runTests ?? runTests
      if (config.testCmd.trim() !== "") {
        let testPassed = false
        let retrySessionId: string | undefined
        renderer.setStatus(pkg.title, "testing", { current: 1, max: config.testRetries + 1 })

        for (let retry = 0; retry <= config.testRetries; retry++) {
          const testResult = yield* testFn(config.testCmd)

          if (testResult.exitCode === 0) {
            testPassed = true
            break
          }

          if (retry >= config.testRetries) {
            renderer.setStatus(pkg.title, "failed")
            renderer.finish(`Tests failed after ${config.testRetries} retries. Stopping.`)
            yield* notify("gtd", `Tests failed after ${config.testRetries} retries.`)
            return
          }

          renderer.setStatus(pkg.title, "building")

          const currentSessionId = retrySessionId ?? buildSessionId
          if (currentSessionId) {
            // Resume session — minimal prompt, agent already has full context
            const retryPrompt = `Tests failed:\n\`\`\`\n${testResult.output}\n\`\`\`\nFix the failures.`
            const fixResult = yield* agent
              .invoke({
                prompt: retryPrompt,
                systemPrompt: "",
                mode: "build",
                cwd: process.cwd(),
                onEvent: renderer.onEvent,
                resumeSessionId: currentSessionId,
              })
              .pipe(Effect.ensuring(Effect.sync(() => {})))
            retrySessionId = fixResult.sessionId ?? currentSessionId
          } else {
            // Fallback: full prompt (non-session agents)
            const currentContent = yield* fs.readFile()
            const currentPkg = getNextUncheckedPackage(currentContent)
            const currentItems = Option.isSome(currentPkg)
              ? formatPackagePrompt(currentPkg.value, planFilePath)
              : itemSection
            const currentLearnings = extractLearnings(currentContent)
            const currentLearningsSection =
              currentLearnings.trim() !== ""
                ? `### Learnings\n\n${currentLearnings}`
                : "No learnings yet."

            const fixPrompt = interpolate(buildPrompt, {
              item: currentItems,
              learnings: currentLearningsSection,
              completed: completedSection,
              testOutput: `### Test Failure (attempt ${retry + 1})\n\n\`\`\`\n${testResult.output}\n\`\`\`\n\nFix the test failures above.`,
            })

            yield* agent
              .invoke({
                prompt: fixPrompt,
                systemPrompt: "",
                mode: "build",
                cwd: process.cwd(),
                onEvent: renderer.onEvent,
              })
              .pipe(Effect.ensuring(Effect.sync(() => {})))
          }

          renderer.setStatus(pkg.title, "testing", { current: retry + 2, max: config.testRetries + 1 })
        }

        if (!testPassed) return
      }

      renderer.setStatus(pkg.title, "done")
      const buildDiff = yield* git.getDiff()
      const buildCommitMsg = yield* generateCommitMessage("🔨", buildDiff)
      yield* git.atomicCommit("all", buildCommitMsg)
      completedSummaries.push(`- ${pkg.title}: implemented and tests passing`)
    }

    // Clear session file so next plan starts fresh
    if (fs.deleteSessionFile) {
      yield* fs.deleteSessionFile()
    }

    renderer.finish("All items built.")
    renderer.dispose()
    yield* notify("gtd", "All items built.")
  }).pipe(catchAgentError)

const formatPackagePrompt = (pkg: Package, planFilePath: string): string => {
  const unchecked = pkg.items.filter((i) => !i.checked)
  const itemsText = unchecked
    .map((item) => `- [ ] ${item.title}\n${item.body}`)
    .join("\n")
  return `### ${pkg.title}\n\nPlan file: ${planFilePath}\n\n${itemsText}`
}

const runTests = (cmd: string): Effect.Effect<TestResult> =>
  Effect.async<TestResult, Error>((resume) => {
    const parts = cmd.split(" ")
    const proc = Bun.spawn(parts, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
    })

    Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]).then(
      ([exitCode, stdout, stderr]) => {
        resume(Effect.succeed({ exitCode, output: stdout + stderr }))
      },
      (error) => {
        resume(Effect.fail(new Error(String(error))))
      },
    )

    return Effect.sync(() => {
      proc.kill()
    })
  }).pipe(
    Effect.timeout(Duration.minutes(5)),
    Effect.catchTag("TimeoutException", () =>
      Effect.succeed({ exitCode: 1, output: "Test process timed out after 5 minutes" }),
    ),
    Effect.catchAll((error) => Effect.succeed({ exitCode: 1, output: String(error) })),
  )

export const makeBuildCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  return yield* buildCommand(bunFileOps(config.file))
})
