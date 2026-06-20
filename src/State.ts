import { FileSystem } from "@effect/platform"
import { Effect, Option } from "effect"
import { type GitOperations, GitService } from "./Git.js"

export type Branch =
  | "new-todo"
  | "modified-todo"
  | "decompose"
  | "execute"
  | "execute-simple"
  | "cleanup"
  | "code-changes"
  | "todo-markers"
  | "verify"
  | "human-review"
  | "verified"
  | "review-create"
  | "review-process"

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
  readonly baseRef?: string
  readonly refDiff?: string
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

export const computeReviewBase = (
  git: GitOperations,
): Effect.Effect<Option.Option<string>, Error> =>
  Effect.gen(function* () {
    // Gather candidates
    const defaultBranch = yield* git.resolveDefaultBranch()
    const parentBranchCandidate: Option.Option<string> = Option.isSome(defaultBranch)
      ? yield* git.mergeBase(defaultBranch.value, "HEAD")
      : Option.none()

    const lastReviewCandidate = yield* git.lastReviewCommit()

    // Collect present candidates
    const rawCandidates: Array<string> = []
    if (Option.isSome(parentBranchCandidate)) rawCandidates.push(parentBranchCandidate.value)
    if (Option.isSome(lastReviewCandidate)) rawCandidates.push(lastReviewCandidate.value)

    if (rawCandidates.length === 0) return Option.none<string>()

    // Resolve HEAD hash for equality check
    const headHash = yield* git.resolveRef("HEAD")

    // Filter: must be ancestor of HEAD; equal-to-HEAD means nothing to review
    const qualified: Array<{ hash: string; count: number }> = []
    for (const hash of rawCandidates) {
      if (hash === headHash) continue
      const ancestor = yield* git.isAncestor(hash, "HEAD")
      if (!ancestor) continue
      const count = yield* git.commitCount(hash)
      qualified.push({ hash, count })
    }

    if (qualified.length === 0) return Option.none<string>()

    // Pick the one with smallest commitCount (closest to HEAD)
    let best = qualified[0]!
    for (let i = 1; i < qualified.length; i++) {
      const candidate = qualified[i]!
      if (candidate.count < best.count) {
        best = candidate
      } else if (candidate.count === best.count) {
        // Tie-break: prefer the descendant (if best is ancestor of candidate, candidate is descendant)
        const bestIsAncestor = yield* git.isAncestor(best.hash, candidate.hash)
        if (bestIsAncestor) best = candidate
      }
    }

    return Option.some(best.hash)
  })

export const detect = (refArg?: string): Effect.Effect<State, Error, GitService | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem

    if (refArg !== undefined) {
      const porcelainCheck = yield* git.statusPorcelain()
      const dirty = porcelainCheck.trim().length > 0
      if (dirty) {
        yield* Effect.fail(new Error("Commit or stash changes before starting review"))
      }

      const reviewExists = yield* fs.exists("REVIEW.md")
      if (reviewExists) {
        yield* Effect.fail(new Error("REVIEW.md already exists. Complete or delete existing review before starting new one."))
      }

      const resolvedRef = yield* git.resolveRef(refArg)

      const diffStat = yield* git.diffStatRef(resolvedRef)
      if (diffStat.trim().length === 0) {
        yield* Effect.fail(new Error(`No changes between \`${refArg}\` and HEAD to review`))
      }

      const refDiff = yield* git.diffRef(resolvedRef)
      const hasCommits = yield* git.hasCommits()
      const lastCommitSubject = hasCommits ? yield* git.lastCommitSubject() : ""
      const packages = yield* getPackages(fs)

      return {
        branches: ["review-create" as Branch],
        lastCommitSubject,
        diff: "",
        workingTreeClean: true,
        packages,
        baseRef: resolvedRef,
        refDiff,
      }
    }

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
    // Strip fenced code blocks and inline code spans before checking so that
    // references to the marker string inside code examples don't count.
    const UNANSWERED_MARKER = "<!-- user answers here -->"
    const stripCode = (content: string): string =>
      content
        .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[^\n]*/gm, "")
        .replace(/`[^`\n]+`/g, "")
    const todoFinalized = yield* fs.exists(TODO_FILE).pipe(
      Effect.flatMap((exists) =>
        exists
          ? fs
              .readFileString(TODO_FILE)
              .pipe(Effect.map((content) => !stripCode(content).includes(UNANSWERED_MARKER)))
          : Effect.succeed(false),
      ),
    )

    // review-process: REVIEW.md exists with user edits
    const reviewExists = yield* fs.exists("REVIEW.md")
    if (reviewExists) {
      const reviewModified = entries.some((e) => e.path === "REVIEW.md")
      if (!reviewModified) {
        yield* Effect.fail(
          new Error(
            "REVIEW.md exists but has no changes. Edit REVIEW.md to provide feedback, or delete it to abandon review.",
          ),
        )
      }
      const reviewContent = yield* fs
        .readFileString("REVIEW.md")
        .pipe(Effect.mapError((e) => new Error(String(e))))
      const baseMatch = reviewContent.match(/<!--\s*base:\s*([a-f0-9]+)\s*-->/)
      if (!baseMatch) {
        yield* Effect.fail(
          new Error(
            "REVIEW.md is corrupted: missing base ref. Delete REVIEW.md and re-run with git ref to restart review.",
          ),
        )
      }
      const baseRef = baseMatch![1] as string
      return {
        branches: ["review-process" as Branch],
        lastCommitSubject,
        diff,
        workingTreeClean: clean,
        packages,
        baseRef,
      } satisfies State
    }

    const branches: Array<Branch> = []

    if (clean) {
      if (packages.length > 0) {
        // .gtd/ has packages to execute
        branches.push("execute")
      } else if (gtdExists) {
        // .gtd/ exists but is empty — cleanup
        branches.push("cleanup")
      } else if (todoFinalized) {
        const todoContent = yield* fs.readFileString(TODO_FILE)
        const isSimple = todoContent.includes("<!-- simple -->")
        if (isSimple) {
          branches.push("execute-simple")
        } else {
          branches.push("decompose")
        }
      } else {
        const reviewBase = yield* computeReviewBase(git)
        if (Option.isSome(reviewBase)) {
          const base = reviewBase.value
          const diff = yield* git.diffRef(base)
          if (diff.trim().length > 0) {
            branches.push("human-review")
            return {
              branches,
              lastCommitSubject,
              diff: "",
              workingTreeClean: true,
              packages,
              baseRef: base,
              refDiff: diff,
            } satisfies State
          }
        }
        branches.push("verified")
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
