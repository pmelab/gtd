import { FileSystem } from "@effect/platform"
import { Effect, Option } from "effect"
import { type GitOperations, GitService } from "./Git.js"
import type { GtdEvent, GtdPackageFact, ResolvePayload } from "./Machine.js"

/**
 * The Effect "edge": all git/filesystem IO lives here. It probes the working
 * tree and commit history, then produces the typed event array
 * (`COMMIT[]` followed by a single `RESOLVE`) that the pure machine folds.
 *
 * The machine (src/Machine.ts) stays free of IO; this module is the only place
 * that touches git/fs while building events.
 */

const TODO_FILE = "TODO.md"
const GTD_DIR = ".gtd"
const REVIEW_FILE = "REVIEW.md"
const UNANSWERED_MARKER = "<!-- user answers here -->"
const SIMPLE_MARKER = "<!-- simple -->"

const parsePorcelainPaths = (porcelain: string): ReadonlyArray<{ status: string; path: string }> =>
  porcelain
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }))

const isNumberedDir = (name: string): boolean => /^\d+-/.test(name)

const isTaskFile = (name: string): boolean => name.endsWith(".md") && name !== "COMMIT_MSG.md"

const getPackages = (
  fs: FileSystem.FileSystem,
): Effect.Effect<ReadonlyArray<GtdPackageFact>, Error> =>
  Effect.gen(function* () {
    const gtdExists = yield* fs.exists(GTD_DIR)
    if (!gtdExists) return []

    const entries = yield* fs.readDirectory(GTD_DIR)
    const packageDirs = entries.filter(isNumberedDir).sort()

    const packages: Array<GtdPackageFact> = []
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

/**
 * Strip fenced code blocks and inline code spans so that references to marker
 * strings inside code examples don't count toward "finalized" detection.
 */
const stripCode = (content: string): string =>
  content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[^\n]*/gm, "").replace(/`[^`\n]+`/g, "")

/**
 * Pick the best review base ref to diff HEAD against: the merge-base with the
 * default branch and the last `review(gtd): create review for ...` commit are
 * candidates; we keep ancestors of HEAD (that aren't HEAD itself) and pick the
 * one closest to HEAD by commit count, tie-breaking toward the descendant.
 *
 * NOTE: this is the canonical home for this logic. State.ts still keeps its own
 * copy until the cutover; keep both identical.
 */
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

/**
 * Gather ALL git/filesystem facts and produce the typed event stream the pure
 * machine folds: one `COMMIT` per first-parent commit (oldest→newest) followed
 * by a single `RESOLVE` carrying the working-tree snapshot.
 */
export const gatherEvents = (): Effect.Effect<
  ReadonlyArray<GtdEvent>,
  Error,
  GitService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem

    // --- COMMIT events -------------------------------------------------------
    // Stream base = merge-base(defaultBranch, HEAD) when both resolve, else
    // undefined (whole-history fallback for no-default-branch / no-merge-base).
    const defaultBranch = yield* git.resolveDefaultBranch()
    const base = Option.isSome(defaultBranch)
      ? yield* git.mergeBase(defaultBranch.value, "HEAD")
      : Option.none<string>()

    const subjects = yield* git.commitSubjects(Option.getOrUndefined(base))
    const commitEvents: Array<GtdEvent> = subjects.map((subject) => ({
      type: "COMMIT",
      isFixGtd: /^fix\(gtd\):/.test(subject),
    }))

    // --- RESOLVE payload (working-tree snapshot) -----------------------------
    const hasCommits = yield* git.hasCommits()
    const porcelain = hasCommits ? yield* git.statusPorcelain() : ""
    const entries = parsePorcelainPaths(porcelain)
    const workingTreeClean = entries.length === 0

    const todoEntry = entries.find((e) => e.path === TODO_FILE)
    const nonTodoEntries = entries.filter((e) => e.path !== TODO_FILE)
    const codeDirty = nonTodoEntries.length > 0

    const todoDirty: "new" | "modified" | null = todoEntry
      ? todoEntry.status.includes("?") || todoEntry.status.includes("A")
        ? "new"
        : "modified"
      : null

    const lastCommitSubject = hasCommits ? yield* git.lastCommitSubject() : ""
    const diff = entries.length > 0 ? yield* git.diffHead() : ""

    const packages = yield* getPackages(fs)
    const hasPackages = packages.length > 0
    const gtdDirExists = yield* fs.exists(GTD_DIR)

    // TODO.md finalized: exists AND, after stripping code, no unanswered marker.
    const todoExists = yield* fs.exists(TODO_FILE)
    const todoContent = todoExists
      ? yield* fs.readFileString(TODO_FILE).pipe(Effect.mapError((e) => new Error(String(e))))
      : ""
    const todoFinalized = todoExists && !stripCode(todoContent).includes(UNANSWERED_MARKER)
    const todoSimple = todoExists && todoContent.includes(SIMPLE_MARKER)

    // REVIEW.md probing — preserve existing error semantics from State.ts.
    let reviewModified = false
    let reviewBaseRef: string | undefined
    const reviewExists = yield* fs.exists(REVIEW_FILE)
    if (reviewExists) {
      reviewModified = entries.some((e) => e.path === REVIEW_FILE)
      if (!reviewModified) {
        yield* Effect.fail(
          new Error(
            "REVIEW.md exists but has no changes. Edit REVIEW.md to provide feedback, or delete it to abandon review.",
          ),
        )
      }
      const reviewContent = yield* fs
        .readFileString(REVIEW_FILE)
        .pipe(Effect.mapError((e) => new Error(String(e))))
      const baseMatch = reviewContent.match(/<!--\s*base:\s*([a-f0-9]+)\s*-->/)
      if (!baseMatch) {
        yield* Effect.fail(
          new Error(
            "REVIEW.md is corrupted: missing base ref. Delete REVIEW.md and re-run with git ref to restart review.",
          ),
        )
      }
      reviewBaseRef = baseMatch![1] as string
    }

    // Review base for the human-review branch.
    const reviewBase = yield* computeReviewBase(git)
    const reviewBasePresent = Option.isSome(reviewBase)
    let computedBaseRef: string | undefined
    let refDiff: string | undefined
    if (Option.isSome(reviewBase)) {
      const candidateDiff = yield* git.diffRef(reviewBase.value)
      if (candidateDiff.trim().length > 0) {
        computedBaseRef = reviewBase.value
        refDiff = candidateDiff
      }
    }

    const payload: ResolvePayload = {
      reviewModified,
      codeDirty,
      hasPackages,
      gtdDirExists,
      todoDirty,
      todoFinalized,
      todoSimple,
      reviewBasePresent,
      lastCommitSubject,
      workingTreeClean,
      packages,
      diff,
      ...(reviewBaseRef !== undefined
        ? { baseRef: reviewBaseRef }
        : computedBaseRef !== undefined
          ? { baseRef: computedBaseRef }
          : {}),
      ...(refDiff !== undefined ? { refDiff } : {}),
    }

    return [...commitEvents, { type: "RESOLVE", payload }] as ReadonlyArray<GtdEvent>
  })
