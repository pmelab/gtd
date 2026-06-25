import header from "./prompts/header.md"
import newTodo from "./prompts/new-todo.md"
import modifiedTodo from "./prompts/modified-todo.md"
import decompose from "./prompts/decompose.md"
import execute from "./prompts/execute.md"
import escalate from "./prompts/escalate.md"
import humanReview from "./prompts/human-review.md"
import verified from "./prompts/verified.md"
import reviewProcess from "./prompts/review-process.md"
import awaitReview from "./prompts/await-review.md"
import reviewIncomplete from "./prompts/review-incomplete.md"
import awaitAnswers from "./prompts/await-answers.md"
import fixTests from "./prompts/fix-tests.md"
import autoAdvance from "./prompts/partials/auto-advance.md"
import { builtinTierDefault, stateTier, type ModelState } from "./Config.js"
import type { GtdContext, GtdPackageFact, LeafState, ResolveResult } from "./Machine.js"

/**
 * The four leaf states whose prompts spawn subagents and therefore carry a
 * `{{MODEL}}` placeholder. These coincide with `ModelState` from `Config.ts`.
 */
const MODEL_STATES = new Set<LeafState>([
  "new-todo",
  "modified-todo",
  "decompose",
  "execute",
])

/**
 * Built-in resolver used when no caller-supplied resolver is given. Reuses the
 * single source of truth in `Config.ts` (state→tier map + built-in tier
 * defaults) so it can never drift from `ConfigService`'s defaults.
 */
const builtinResolveModel = (state: ModelState): string => builtinTierDefault[stateTier[state]]

const SECTIONS: Record<
  Exclude<LeafState, "cleanup" | "close-review" | "code-changes" | "commit-pending">,
  string
> = {
  "new-todo": newTodo,
  "modified-todo": modifiedTodo,
  decompose,
  execute,
  escalate,
  "human-review": humanReview,
  verified,
  "review-process": reviewProcess,
  "await-review": awaitReview,
  "await-answers": awaitAnswers,
  "review-incomplete": reviewIncomplete,
  "fix-tests": fixTests,
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

export type PromptOverride =
  | { readonly kind: "fix-tests"; readonly testOutput: string }
  | { readonly kind: "review-process"; readonly reviewDiff: string; readonly recordSha: string }

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
    lines.push(`The next cycle's edge commits this package using \`${pkg.name}/COMMIT_MSG.md\`.`)
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
  } else if (override?.kind === "review-process") {
    const fence = fenceFor(override.reviewDiff)
    parts.push(SECTIONS["review-process"], "")
    parts.push("### Review feedback diff", "")
    parts.push(fence, override.reviewDiff.replace(/\n$/, ""), fence, "")
    parts.push(`If you lose this diff, recover it with \`git show ${override.recordSha}\`.`, "")
    if (result.autoAdvance) {
      parts.push(autoAdvance, "")
    }
  } else {
    const value = result.value as LeafState
    if (
      value === "cleanup" ||
      value === "close-review" ||
      value === "code-changes" ||
      value === "commit-pending"
    ) {
      throw new Error(
        `Action leaf "${value}" is executed by the edge and must never reach buildPrompt`,
      )
    }
    const section = MODEL_STATES.has(value)
      ? SECTIONS[value].replaceAll("{{MODEL}}", resolveModel(value as ModelState))
      : SECTIONS[value]
    parts.push(section, "")
    const selectedPackage = result.context.packages[0]
    if (value === "execute" && selectedPackage !== undefined) {
      parts.push(renderPackage(selectedPackage), "")
      // `.gtd/` removal (including the last-package case) is handled by the
      // edge's `commitPending({ removeLastPackage })` action, not the prompt.
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
