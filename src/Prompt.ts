import header from "./prompts/header.md"
import newTodo from "./prompts/new-todo.md"
import modifiedTodo from "./prompts/modified-todo.md"
import build from "./prompts/build.md"
import codeChanges from "./prompts/code-changes.md"
import todoMarkers from "./prompts/todo-markers.md"
import verify from "./prompts/verify.md"
import type { Branch, State } from "./State.js"

const SECTIONS: Record<Branch, string> = {
  "new-todo": newTodo,
  "modified-todo": modifiedTodo,
  build,
  "code-changes": codeChanges,
  "todo-markers": todoMarkers,
  verify,
}

const buildContext = (state: State): string => {
  const lines: Array<string> = ["## Context", ""]
  lines.push(
    state.lastCommitSubject === ""
      ? "Last commit: _(repository has no commits yet)_"
      : `Last commit: \`${state.lastCommitSubject}\``,
  )
  lines.push(`Working tree: ${state.workingTreeClean ? "clean" : "dirty"}`)
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
