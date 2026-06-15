import { Effect } from "effect"
import { GitService } from "./Git.js"

export type Branch =
  | "new-todo"
  | "modified-todo"
  | "build"
  | "code-changes"
  | "todo-markers"
  | "run-tests"

export interface State {
  readonly branches: ReadonlyArray<Branch>
  readonly lastCommitSubject: string
  readonly diff: string
  readonly workingTreeClean: boolean
}

const TODO_FILE = "TODO.md"

const parsePorcelainPaths = (porcelain: string): ReadonlyArray<{ status: string; path: string }> =>
  porcelain
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }))

const diffAddsTodoMarker = (diff: string): boolean =>
  diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .some((line) => /\bTODO:/.test(line))

export const detect = (): Effect.Effect<State, Error, GitService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const hasCommits = yield* git.hasCommits()
    const porcelain = hasCommits ? yield* git.statusPorcelain() : ""
    const entries = parsePorcelainPaths(porcelain)
    const clean = entries.length === 0
    const lastCommitSubject = hasCommits ? yield* git.lastCommitSubject() : ""
    const lastCommitFiles = hasCommits ? yield* git.lastCommitFiles() : []
    const diff = entries.length > 0 ? yield* git.diffHead() : ""

    const lastCommitIsTodoOnly =
      lastCommitFiles.length === 1 && lastCommitFiles[0] === TODO_FILE

    const todoEntry = entries.find((e) => e.path === TODO_FILE)
    const nonTodoEntries = entries.filter((e) => e.path !== TODO_FILE)

    const branches: Array<Branch> = []

    if (clean) {
      if (lastCommitIsTodoOnly) branches.push("build")
      else branches.push("run-tests")
    } else {
      if (todoEntry) {
        const isNew = todoEntry.status.includes("?") || todoEntry.status.includes("A")
        branches.push(isNew ? "new-todo" : "modified-todo")
      }
      if (nonTodoEntries.length > 0) {
        if (diffAddsTodoMarker(diff)) branches.push("todo-markers")
        branches.push("code-changes")
      }
    }

    return { branches, lastCommitSubject, diff, workingTreeClean: clean }
  })
