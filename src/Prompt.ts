import header from "./prompts/header.md"
import newTodo from "./prompts/new-todo.md"
import modifiedTodo from "./prompts/modified-todo.md"
import decompose from "./prompts/decompose.md"
import execute from "./prompts/execute.md"
import cleanup from "./prompts/cleanup.md"
import codeChanges from "./prompts/code-changes.md"
import todoMarkers from "./prompts/todo-markers.md"
import verify from "./prompts/verify.md"
import reviewCreate from "./prompts/review-create.md"
import reviewProcess from "./prompts/review-process.md"
import type { Branch, State } from "./State.js"

const SECTIONS: Record<Branch, string> = {
  "new-todo": newTodo,
  "modified-todo": modifiedTodo,
  decompose,
  execute,
  cleanup,
  "code-changes": codeChanges,
  "todo-markers": todoMarkers,
  verify,
  "review-create": reviewCreate,
  "review-process": reviewProcess,
}

const buildContext = (state: State): string => {
  const lines: Array<string> = ["## Context", ""]
  lines.push(
    state.lastCommitSubject === ""
      ? "Last commit: _(repository has no commits yet)_"
      : `Last commit: \`${state.lastCommitSubject}\``,
  )
  lines.push(`Working tree: ${state.workingTreeClean ? "clean" : "dirty"}`)

  if (state.packages.length > 0) {
    lines.push("")
    lines.push("### Work packages in `.gtd/`")
    lines.push("")
    for (const pkg of state.packages) {
      lines.push(`- \`${pkg.name}/\``)
      for (const task of pkg.tasks) {
        lines.push(`  - \`${task}\``)
      }
    }
  }

  if (state.refDiff) {
    lines.push("")
    lines.push(`### Diff (\`git diff ${state.baseRef} HEAD\`)`)
    lines.push("")
    lines.push("```diff")
    lines.push(state.refDiff.replace(/\n$/, ""))
    lines.push("```")
    lines.push("")
  }
  lines.push("")
  if (state.diff !== "") {
    lines.push("### Diff (`git diff HEAD`, with untracked files included)")
    lines.push("")
    lines.push("```diff")
    lines.push(state.diff.replace(/\n$/, ""))
    lines.push("```")
    lines.push("")
  }
  return lines.join("\n")
}

export const buildPrompt = (state: State): string => {
  const parts: Array<string> = [header, "", buildContext(state)]
  for (const branch of state.branches) parts.push(SECTIONS[branch], "")
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
}
