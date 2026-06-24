import header from "./prompts/header.md"
import newTodo from "./prompts/new-todo.md"
import modifiedTodo from "./prompts/modified-todo.md"
import decompose from "./prompts/decompose.md"
import execute from "./prompts/execute.md"
import executeSimple from "./prompts/execute-simple.md"
import cleanup from "./prompts/cleanup.md"
import codeChanges from "./prompts/code-changes.md"
import escalate from "./prompts/escalate.md"
import humanReview from "./prompts/human-review.md"
import verified from "./prompts/verified.md"
import reviewProcess from "./prompts/review-process.md"
import closeReview from "./prompts/close-review.md"
import awaitReview from "./prompts/await-review.md"
import reviewIncomplete from "./prompts/review-incomplete.md"
import awaitAnswers from "./prompts/await-answers.md"
import fixTests from "./prompts/fix-tests.md"
import autoAdvance from "./prompts/partials/auto-advance.md"
import { builtinTierDefault, stateTier, type ModelState } from "./Config.js"
import type { GtdContext, GtdPackageFact, LeafState, ResolveResult } from "./Machine.js"

/**
 * The five leaf states whose prompts spawn subagents and therefore carry a
 * `{{MODEL}}` placeholder. These coincide with `ModelState` from `Config.ts`.
 */
const MODEL_STATES = new Set<LeafState>([
  "new-todo",
  "modified-todo",
  "decompose",
  "execute",
  "execute-simple",
])

/**
 * Built-in resolver used when no caller-supplied resolver is given. Reuses the
 * single source of truth in `Config.ts` (state→tier map + built-in tier
 * defaults) so it can never drift from `ConfigService`'s defaults.
 */
const builtinResolveModel = (state: ModelState): string =>
  builtinTierDefault[stateTier[state]]

const SECTIONS: Record<LeafState, string> = {
  "new-todo": newTodo,
  "modified-todo": modifiedTodo,
  decompose,
  execute,
  "execute-simple": executeSimple,
  cleanup,
  "code-changes": codeChanges,
  escalate,
  "human-review": humanReview,
  verified,
  "review-process": reviewProcess,
  "close-review": closeReview,
  "await-review": awaitReview,
  "await-answers": awaitAnswers,
  "review-incomplete": reviewIncomplete,
}

const buildContext = (context: GtdContext): string => {
  const lines: Array<string> = ["## Context", ""]
  lines.push(
    context.lastCommitSubject === ""
      ? "Last commit: _(repository has no commits yet)_"
      : `Last commit: \`${context.lastCommitSubject}\``,
  )
  lines.push(`Working tree: ${context.workingTreeClean ? "clean" : "dirty"}`)

  if (context.packages.length > 0) {
    lines.push("")
    lines.push("### Work packages in `.gtd/`")
    lines.push("")
    for (const pkg of context.packages) {
      lines.push(`- \`${pkg.name}/\``)
      for (const task of pkg.tasks) {
        lines.push(`  - \`${task}\``)
      }
    }
  }

  if (context.refDiff) {
    lines.push("")
    lines.push(`### Diff (\`git diff ${context.baseRef} HEAD\`)`)
    lines.push("")
    lines.push("```diff")
    lines.push(context.refDiff.replace(/\n$/, ""))
    lines.push("```")
    lines.push("")
  }
  lines.push("")
  if (context.diff !== "") {
    lines.push("### Diff (`git diff HEAD`, with untracked files included)")
    lines.push("")
    lines.push("```diff")
    lines.push(context.diff.replace(/\n$/, ""))
    lines.push("```")
    lines.push("")
  }
  return lines.join("\n")
}

export interface PromptOverride {
  readonly kind: "fix-tests"
  /** Captured combined stdout+stderr from the failed `npm run test`. */
  readonly testOutput: string
}

/**
 * Picks a code fence long enough to safely wrap `content`, even when the
 * content itself contains runs of backticks (mirrors GitHub-flavored Markdown
 * fencing rules).
 */
const fenceFor = (content: string): string => {
  let longest = 0
  for (const match of content.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length)
  }
  return "`".repeat(Math.max(3, longest + 1))
}

/**
 * Renders the inlined, self-contained block for the single package gtd selected
 * for this execute run. Names the package, notes its `COMMIT_MSG.md` (without
 * inlining its contents), and inlines each task file's raw content fenced via
 * `fenceFor` so backtick-bearing content survives.
 */
const renderPackage = (pkg: GtdPackageFact): string => {
  const lines: Array<string> = ["", `### Package: \`${pkg.name}/\``, ""]
  if (pkg.hasCommitMsg) {
    lines.push(`Commit with the message in \`${pkg.name}/COMMIT_MSG.md\`.`)
    lines.push("")
  }
  for (const task of pkg.taskContents) {
    lines.push(`#### \`${task.name}\``)
    lines.push("")
    const fence = fenceFor(task.content)
    lines.push(fence)
    lines.push(task.content.replace(/\n$/, ""))
    lines.push(fence)
    lines.push("")
  }
  return lines.join("\n")
}

export const buildPrompt = (
  result: ResolveResult,
  override?: PromptOverride,
  resolveModel: (state: ModelState) => string = builtinResolveModel,
): string => {
  const parts: Array<string> = [header, "", buildContext(result.context)]
  if (override?.kind === "fix-tests") {
    const fence = fenceFor(override.testOutput)
    parts.push(fixTests, "", fence, override.testOutput.replace(/\n$/, ""), fence, "")
  } else {
    const value = result.value as LeafState
    const section = MODEL_STATES.has(value)
      ? SECTIONS[value].replaceAll("{{MODEL}}", resolveModel(value as ModelState))
      : SECTIONS[value]
    parts.push(section, "")
    const selectedPackage = result.context.packages[0]
    if (value === "execute" && selectedPackage !== undefined) {
      parts.push(renderPackage(selectedPackage), "")
      if (result.context.packages.length === 1) {
        parts.push(
          "This is the LAST work package. In the SAME commit, also remove the now-empty `.gtd/` directory so the next run proceeds straight to human-review.",
          "",
        )
      }
    }
    if (result.autoAdvance) {
      parts.push(autoAdvance, "")
    }
  }
  return (
    parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  )
}
