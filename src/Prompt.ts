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
import autoAdvance from "./prompts/partials/auto-advance.md"
import type { GtdContext, LeafState, ResolveResult } from "./Machine.js"

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

export const buildPrompt = (result: ResolveResult): string => {
  const value = result.value as LeafState
  const parts: Array<string> = [header, "", buildContext(result.context), SECTIONS[value], ""]
  if (result.autoAdvance) {
    parts.push(autoAdvance, "")
  }
  return (
    parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  )
}
