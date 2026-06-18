import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { GitService } from "./Git.js"

export type Branch =
  | "new-todo"
  | "modified-todo"
  | "decompose"
  | "execute"
  | "cleanup"
  | "code-changes"
  | "todo-markers"
  | "verify"

export interface GtdPackage {
  readonly name: string
  readonly tasks: ReadonlyArray<string>
}

export interface State {
  readonly branches: ReadonlyArray<Branch>
  readonly lastCommitSubject: string
  readonly diff: string
  readonly workingTreeClean: boolean
  readonly packages: ReadonlyArray<GtdPackage>
}

const TODO_FILE = "TODO.md"
const GTD_DIR = ".gtd"

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

const isNumberedDir = (name: string): boolean => /^\d+-/.test(name)

const isTaskFile = (name: string): boolean => name.endsWith(".md") && name !== "COMMIT_MSG.md"

const getPackages = (
  fs: FileSystem.FileSystem,
): Effect.Effect<ReadonlyArray<GtdPackage>, Error> =>
  Effect.gen(function* () {
    const gtdExists = yield* fs.exists(GTD_DIR)
    if (!gtdExists) return []

    const entries = yield* fs.readDirectory(GTD_DIR)
    const packageDirs = entries.filter(isNumberedDir).sort()

    const packages: Array<GtdPackage> = []
    for (const dir of packageDirs) {
      const packagePath = `${GTD_DIR}/${dir}`
      const stat = yield* fs.stat(packagePath)
      if (stat.type !== "Directory") continue

      const files = yield* fs.readDirectory(packagePath)
      const tasks = files.filter(isTaskFile).sort()
      packages.push({ name: dir, tasks })
    }

    return packages
  }).pipe(Effect.mapError((e) => new Error(String(e))))

export const detect = (): Effect.Effect<State, Error, GitService | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem

    const hasCommits = yield* git.hasCommits()
    const porcelain = hasCommits ? yield* git.statusPorcelain() : ""
    const entries = parsePorcelainPaths(porcelain)
    const clean = entries.length === 0
    const lastCommitSubject = hasCommits ? yield* git.lastCommitSubject() : ""
    const diff = entries.length > 0 ? yield* git.diffHead() : ""

    const todoEntry = entries.find((e) => e.path === TODO_FILE)
    const nonTodoEntries = entries.filter((e) => e.path !== TODO_FILE)

    const packages = yield* getPackages(fs)
    const gtdExists = yield* fs.exists(GTD_DIR)

    // A TODO.md is "finalized" when it exists on disk and contains no
    // unanswered question markers — regardless of commit history.
    const UNANSWERED_MARKER = "<!-- user answers here -->"
    const todoFinalized = yield* fs.exists(TODO_FILE).pipe(
      Effect.flatMap((exists) =>
        exists
          ? fs
              .readFileString(TODO_FILE)
              .pipe(Effect.map((content) => !content.includes(UNANSWERED_MARKER)))
          : Effect.succeed(false),
      ),
    )

    const branches: Array<Branch> = []

    if (clean) {
      if (packages.length > 0) {
        // .gtd/ has packages to execute
        branches.push("execute")
      } else if (gtdExists) {
        // .gtd/ exists but is empty — cleanup
        branches.push("cleanup")
      } else if (todoFinalized) {
        // TODO.md has no unanswered questions — decompose into packages
        branches.push("decompose")
      } else {
        branches.push("verify")
      }
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

    return { branches, lastCommitSubject, diff, workingTreeClean: clean, packages }
  })
