import { FileSystem } from "@effect/platform"
import { Effect, Option } from "effect"
import { type BangComment, type GitOperations, GitService } from "./Git.js"
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
const ERRORS_FILE = "ERRORS.md"
const UNANSWERED_MARKER = "<!-- user answers here -->"
const SIMPLE_MARKER = "<!-- simple -->"

/**
 * Parse the `status:` value from a leading YAML frontmatter block. Folds the
 * legacy `<!-- simple -->` marker into `"simple"` for backward compatibility.
 */
const parseTodoStatus = (content: string): "simple" | "complete" | "grilling" | null => {
  const fm = content.match(/^---\n([\s\S]*?)\n---/)
  if (fm) {
    const m = fm[1]!.match(/^\s*status:\s*(\w+)/m)
    if (m) {
      const v = m[1]
      if (v === "simple" || v === "complete" || v === "grilling") return v
    }
  }
  if (content.includes(SIMPLE_MARKER)) return "simple"
  return null
}

/**
 * Whether TODO.md still has unanswered questions: the legacy answer placeholder,
 * or a `## Open Questions` section that contains at least one `### ` entry
 * before the next `## ` heading.
 */
const hasOpenQuestions = (content: string): boolean => {
  if (content.includes(UNANSWERED_MARKER)) return true
  const m = content.match(/^##\s+Open Questions\s*\n([\s\S]*?)(?=\n##\s|\n---|\s*$)/m)
  return m ? /^###\s+/m.test(m[1]!) : false
}

const parsePorcelainPaths = (porcelain: string): ReadonlyArray<{ status: string; path: string }> =>
  porcelain
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }))

const isNumberedDir = (name: string): boolean => /^\d+-/.test(name)

const isTaskFile = (name: string): boolean => name.endsWith(".md") && name !== "COMMIT_MSG.md"

export const getPackages = (
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
      const taskContents: Array<{ name: string; content: string }> = []
      for (const taskFile of tasks) {
        const content = yield* fs.readFileString(`${packagePath}/${taskFile}`)
        taskContents.push({ name: taskFile, content })
      }
      const hasCommitMsg = files.includes("COMMIT_MSG.md")
      packages.push({ name: dir, tasks, taskContents, hasCommitMsg })
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
    const lastCloseCandidate = yield* git.lastCloseCommit()

    // Resolve HEAD hash for equality checks.
    const headHash = yield* git.resolveRef("HEAD")

    // Frontier-at-HEAD: if HEAD itself is the latest review/close bookkeeping
    // commit, the review frontier has reached HEAD — everything up to HEAD is
    // already reviewed (a close commit means "approved", a review commit means a
    // REVIEW.md is already present and handled separately), so there is nothing
    // new to diff. Returning a base here would fall back to an older candidate
    // (e.g. the prior review commit) whose diff to HEAD is the close commit's own
    // REVIEW.md deletion — re-surfacing it as a fresh review and looping forever.
    if (
      (Option.isSome(lastReviewCandidate) && lastReviewCandidate.value === headHash) ||
      (Option.isSome(lastCloseCandidate) && lastCloseCandidate.value === headHash)
    ) {
      return Option.none<string>()
    }

    // Collect present candidates
    const rawCandidates: Array<string> = []
    if (Option.isSome(parentBranchCandidate)) rawCandidates.push(parentBranchCandidate.value)
    if (Option.isSome(lastReviewCandidate)) rawCandidates.push(lastReviewCandidate.value)
    if (Option.isSome(lastCloseCandidate)) rawCandidates.push(lastCloseCandidate.value)

    if (rawCandidates.length === 0) return Option.none<string>()

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
    // Verbatim-first: any uncommitted change outside the tool's own control
    // files (TODO.md, REVIEW.md) is "code" that must be committed before any
    // gate is evaluated. REVIEW.md checkbox edits are handled by the review
    // branch, not treated as code.
    const codeEntries = entries.filter(
      (e) => e.path !== TODO_FILE && e.path !== REVIEW_FILE,
    )
    const codeDirty = codeEntries.length > 0

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

    // A committed ERRORS.md means the test loop escalated; it is a human gate.
    const errorsPresent = yield* fs.exists(ERRORS_FILE)

    // TODO.md state is driven by its `status:` frontmatter (source of truth),
    // with open-questions presence gating the await-answers branch.
    const todoExists = yield* fs.exists(TODO_FILE)
    const todoContent = todoExists
      ? yield* fs.readFileString(TODO_FILE).pipe(Effect.mapError((e) => new Error(String(e))))
      : ""
    const stripped = stripCode(todoContent)
    const todoStatus = todoExists ? parseTodoStatus(stripped) : null
    const todoOpenQuestionsPresent = todoExists && hasOpenQuestions(stripped)

    // REVIEW.md probing.
    let reviewModified = false
    let reviewUnmodified = false
    let reviewApprovedNoChanges = false
    let reviewBaseRef: string | undefined
    // Scan tracked source for `!!` follow-up comments (leftover review work).
    // Only harvested when REVIEW.md exists; scoped to its chunk-referenced files
    // ∪ dirty working-tree paths (excluding REVIEW.md / TODO.md themselves).
    let bangComments: ReadonlyArray<BangComment> = []
    let bangPresent = false
    const reviewExists = yield* fs.exists(REVIEW_FILE)
    if (reviewExists) {
      reviewModified = entries.some((e) => e.path === REVIEW_FILE)
      // A committed, unmodified REVIEW.md is the review gate: the human has not
      // recorded any feedback yet. Wait for them rather than erroring.
      reviewUnmodified = !reviewModified
      const reviewContent = yield* fs
        .readFileString(REVIEW_FILE)
        .pipe(Effect.mapError((e) => new Error(String(e))))

      // Build pathspec: REVIEW.md chunk refs ∪ dirty entries (excluding control files)
      const chunkRefPaths = Array.from(
        reviewContent.matchAll(/^- \[[ x]\] (\.\/[^\s#]+)/gm),
        (m) => m[1]!.replace(/^\.\//, ""),
      )
      const dirtyPaths = codeEntries.map((e) => e.path)
      const pathspecSet = new Set([...chunkRefPaths, ...dirtyPaths])
      const pathspec = Array.from(pathspecSet)

      bangComments = yield* git.grepBang(pathspec)
      bangPresent = bangComments.length > 0
      const baseMatch = reviewContent.match(/<!--\s*base:\s*([a-f0-9]+)\s*-->/)
      if (!baseMatch) {
        yield* Effect.fail(
          new Error(
            "REVIEW.md is corrupted: missing base ref. Delete REVIEW.md and re-run with git ref to restart review.",
          ),
        )
      }
      reviewBaseRef = baseMatch![1] as string

      // Compute reviewApprovedNoChanges:
      // true iff reviewModified AND REVIEW.md is the ONLY dirty path AND the
      // diff is forward-ticks only (every changed line: - [ ] → - [x] with
      // identical remainder, at least one tick, equal line counts).
      // Note: codeDirty counts REVIEW.md as dirty too, so check entries directly.
      const onlyReviewDirty = entries.every((e) => e.path === REVIEW_FILE)
      if (onlyReviewDirty) {
        const committedContent = yield* git
          .showHead(REVIEW_FILE)
          .pipe(Effect.mapError((e) => new Error(String(e))))
        const normalise = (line: string) => line.replace(/\r$/, "")
        const committedLines = committedContent.split("\n").map(normalise)
        const workingLines = reviewContent.split("\n").map(normalise)
        const UNTICKED = /^- \[ \] /
        const TICKED = /^- \[x\] /
        const stripMarker = (line: string) => line.replace(/^- \[[ x]\] /, "")
        if (committedLines.length === workingLines.length) {
          let atLeastOneTick = false
          let allDiffsAreForwardTicks = true
          for (let i = 0; i < committedLines.length; i++) {
            const c = committedLines[i]!
            const w = workingLines[i]!
            if (c === w) continue
            if (UNTICKED.test(c) && TICKED.test(w) && stripMarker(c) === stripMarker(w)) {
              atLeastOneTick = true
            } else {
              allDiffsAreForwardTicks = false
              break
            }
          }
          reviewApprovedNoChanges = allDiffsAreForwardTicks && atLeastOneTick
        }
      }
    }

    // Review base for the human-review branch.
    const reviewBase = yield* computeReviewBase(git)
    let reviewBasePresent = false
    let computedBaseRef: string | undefined
    let refDiff: string | undefined
    if (Option.isSome(reviewBase)) {
      const candidateDiff = yield* git.diffRef(reviewBase.value)
      if (candidateDiff.trim().length > 0) {
        reviewBasePresent = true
        computedBaseRef = reviewBase.value
        refDiff = candidateDiff
      }
    }

    const payload: ResolvePayload = {
      errorsPresent,
      reviewModified,
      reviewUnmodified,
      reviewApprovedNoChanges,
      codeDirty,
      hasPackages,
      gtdDirExists,
      todoDirty,
      todoExists,
      todoStatus,
      todoOpenQuestionsPresent,
      bangPresent,
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
      ...(bangComments.length > 0 ? { bangComments } : {}),
    }

    return [...commitEvents, { type: "RESOLVE", payload }] as ReadonlyArray<GtdEvent>
  })
