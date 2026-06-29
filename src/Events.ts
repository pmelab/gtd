import { FileSystem } from "@effect/platform"
import { Effect, Option } from "effect"
import { type GitOperations, GitService } from "./Git.js"
import { formatString } from "./Format.js"
import type { GtdEvent, GtdPackageFact, PendingCommitIntent, ResolvePayload } from "./Machine.js"
import { ConfigService } from "./Config.js"

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
const FEEDBACK_FILE = "FEEDBACK.md"
const ERRORS_FILE = "ERRORS.md"
const UNANSWERED_MARKER = "<!-- user answers here -->"

/**
 * Parse the plan phase from a commit subject line.
 * - `"plan(gtd): grilling"` → `"grilling"`
 * - `"plan(gtd): ready complete"` → `"complete"`
 * - anything else → `null`
 */
export const parsePlanPhase = (subject: string): "grilling" | "complete" | null => {
  const s = subject.trim()
  if (s === "plan(gtd): grilling") return "grilling"
  if (s === "plan(gtd): ready complete") return "complete"
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

    // Frontier-at-HEAD: if the latest review/close bookkeeping commit is either
    // at HEAD or is followed only by gtd-workflow commits (plan(gtd):,
    // review(gtd):, chore(gtd):), the review frontier has effectively reached
    // HEAD — everything up to HEAD is already reviewed. Returning a base here
    // would fall back to an older candidate whose diff to HEAD is pure workflow
    // noise, re-surfacing it as a fresh review and looping forever.
    const isGtdWorkflowSubject = (s: string) =>
      /^(?:plan|review|chore)\(gtd\):/.test(s)

    for (const candidate of [lastReviewCandidate, lastCloseCandidate]) {
      if (!Option.isSome(candidate)) continue
      const candidateHash = candidate.value
      // Must be ancestor of (or equal to) HEAD
      if (candidateHash !== headHash) {
        const ancestor = yield* git.isAncestor(candidateHash, "HEAD")
        if (!ancestor) continue
      }
      // All commits between candidate and HEAD must be gtd-workflow commits
      const subjects = yield* git.commitSubjects(candidateHash)
      if (subjects.every(isGtdWorkflowSubject)) {
        return Option.none<string>()
      }
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
 * True iff the working-tree REVIEW.md content contains at least one unchecked
 * checkbox line (`- [ ] …`).
 */
export const computeReviewHasUncheckedBoxes = (reviewContent: string): boolean =>
  /^- \[ \] /m.test(reviewContent)

/**
 * True iff the REVIEW.md diff represents real feedback (not just forward-ticks).
 *
 * Short-circuits to `true` when other dirty paths exist. Otherwise normalizes
 * the committed copy (replacing `- [ ]` with `- [x]`) and compares formatted
 * strings; returns `true` when they differ.
 */
export const computeReviewHasRealFeedback = (opts: {
  otherDirtyPathsExist: boolean
  committedContent: string
  workingContent: string
}): Effect.Effect<boolean, Error> => {
  if (opts.otherDirtyPathsExist) return Effect.succeed(true)
  const normalizedCommitted = opts.committedContent.replace(/- \[ \] /g, "- [x] ")
  return Effect.gen(function* () {
    const formattedCommitted = yield* formatString(normalizedCommitted).pipe(
      Effect.mapError((e) => new Error(String(e))),
    )
    const formattedWorking = yield* formatString(opts.workingContent).pipe(
      Effect.mapError((e) => new Error(String(e))),
    )
    return formattedCommitted !== formattedWorking
  })
}

/**
 * Count consecutive commits from the END of `msgs` (newest-first) that satisfy
 * `pred`. Used to compute trailing spec-review / test-fix counts.
 */
const countTrailing = (msgs: readonly string[], pred: (m: string) => boolean): number => {
  let count = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (pred(msgs[i]!)) count++
    else break
  }
  return count
}

/**
 * Gather ALL git/filesystem facts and produce the typed event stream the pure
 * machine folds: one `COMMIT` per first-parent commit (oldest→newest) followed
 * by a single `RESOLVE` carrying the working-tree snapshot.
 */
export const gatherEvents = (): Effect.Effect<
  ReadonlyArray<GtdEvent>,
  Error,
  GitService | FileSystem.FileSystem | ConfigService
> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    const config = yield* ConfigService

    // --- COMMIT events -------------------------------------------------------
    // Stream base = merge-base(defaultBranch, HEAD) when both resolve, else
    // undefined (whole-history fallback for no-default-branch / no-merge-base).
    const defaultBranch = yield* git.resolveDefaultBranch()
    const base = Option.isSome(defaultBranch)
      ? yield* git.mergeBase(defaultBranch.value, "HEAD")
      : Option.none<string>()

    const isGtdWorkflowSubjectMsg = (s: string) =>
      /^(?:plan|review|chore)\(gtd\):/.test(s)

    const messages = yield* git.commitMessages(Option.getOrUndefined(base))
    const commitEvents: Array<GtdEvent> = messages.map((message) => {
      const firstLine = message.split("\n")[0] ?? ""
      return {
        type: "COMMIT",
        isTestFix: /^Gtd-Test-Fix:/m.test(message),
        isPlanGrill: /^plan\(gtd\):/.test(firstLine),
        isAgenticReview:
          /^review\(gtd\): agentic review\b/.test(firstLine) ||
          /^Gtd-Agentic-Review:/m.test(message),
        isAgenticApproved: firstLine === "review(gtd): agentic approved",
        isWorkflowCommit: isGtdWorkflowSubjectMsg(firstLine),
        isSpecReview: /^Gtd-Spec-Review:/m.test(message),
      } as unknown as GtdEvent
    })

    // --- RESOLVE payload (working-tree snapshot) -----------------------------
    const hasCommits = yield* git.hasCommits()
    const porcelain = hasCommits ? yield* git.statusPorcelain() : ""
    const entries = parsePorcelainPaths(porcelain)
    const workingTreeClean = entries.length === 0

    const todoEntry = entries.find((e) => e.path === TODO_FILE)
    // Verbatim-first: any uncommitted change outside the tool's own control
    // files (TODO.md, REVIEW.md, FEEDBACK.md) is "code" that must be committed
    // before any gate is evaluated. REVIEW.md checkbox edits are handled by the
    // review branch; FEEDBACK.md is handled by the agentic-approved path.
    const codeEntries = entries.filter(
      (e) => e.path !== TODO_FILE && e.path !== REVIEW_FILE && e.path !== FEEDBACK_FILE,
    )
    const codeDirty = codeEntries.length > 0

    const todoDirty: "new" | "modified" | null = todoEntry
      ? todoEntry.status.includes("?") || todoEntry.status.includes("A")
        ? "new"
        : "modified"
      : null

    const lastCommitSubject = hasCommits ? yield* git.lastCommitSubject() : ""
    const planPhase = parsePlanPhase(lastCommitSubject)
    const diff = entries.length > 0 ? yield* git.diffHead() : ""

    const packages = yield* getPackages(fs)
    const hasPackages = packages.length > 0
    const gtdDirExists = yield* fs.exists(GTD_DIR)

    // A committed ERRORS.md means the test loop escalated; it is a human gate.
    const errorsPresent = yield* fs.exists(ERRORS_FILE)

    // TODO.md open-questions probe.
    const todoExists = yield* fs.exists(TODO_FILE)
    const todoContent = todoExists
      ? yield* fs.readFileString(TODO_FILE).pipe(Effect.mapError((e) => new Error(String(e))))
      : ""
    const stripped = stripCode(todoContent)
    const todoOpenQuestionsPresent = todoExists && hasOpenQuestions(stripped)

    // REVIEW.md probing.
    let reviewModified = false
    let reviewUnmodified = false
    let reviewHasUncheckedBoxes = false
    let reviewHasRealFeedback = false
    let reviewContent: string | undefined
    const reviewExists = yield* fs.exists(REVIEW_FILE)
    if (reviewExists) {
      reviewModified = entries.some((e) => e.path === REVIEW_FILE)
      // A committed, unmodified REVIEW.md is the review gate: the human has not
      // recorded any feedback yet. Wait for them rather than erroring.
      reviewUnmodified = !reviewModified
      reviewContent = yield* fs
        .readFileString(REVIEW_FILE)
        .pipe(Effect.mapError((e) => new Error(String(e))))

      reviewHasUncheckedBoxes = computeReviewHasUncheckedBoxes(reviewContent)

      const reviewEntry0 = entries.find((e) => e.path === REVIEW_FILE)
      const reviewTrackedModified =
        reviewEntry0 !== undefined &&
        !reviewEntry0.status.includes("?") &&
        !reviewEntry0.status.includes("A")
      const otherDirtyPathsExist = !entries.every((e) => e.path === REVIEW_FILE)
      if (otherDirtyPathsExist) {
        reviewHasRealFeedback = true
      } else if (reviewModified && reviewTrackedModified) {
        const committedContent = yield* git
          .showHead(REVIEW_FILE)
          .pipe(Effect.mapError((e) => new Error(String(e))))
        reviewHasRealFeedback = yield* computeReviewHasRealFeedback({
          otherDirtyPathsExist: false,
          committedContent,
          workingContent: reviewContent,
        })
      }
    }

    // reviewDirty: mirrors todoDirty but for REVIEW.md
    const reviewEntry = entries.find((e) => e.path === REVIEW_FILE)
    const reviewDirty: "new" | "modified" | null = reviewEntry
      ? reviewEntry.status.includes("?") || reviewEntry.status.includes("A")
        ? "new"
        : "modified"
      : null

    // FEEDBACK.md probing (mirrors REVIEW.md/TODO.md probing).
    const feedbackExists = yield* fs.exists(FEEDBACK_FILE)
    let feedbackHasContent = false
    if (feedbackExists) {
      const feedbackContent = yield* fs
        .readFileString(FEEDBACK_FILE)
        .pipe(Effect.mapError((e) => new Error(String(e))))
      feedbackHasContent = /\S/.test(feedbackContent)
    }
    const feedbackEntry = entries.find((e) => e.path === FEEDBACK_FILE)
    const feedbackDirty: "new" | "modified" | null = feedbackEntry
      ? feedbackEntry.status.includes("?") || feedbackEntry.status.includes("A")
        ? "new"
        : "modified"
      : null

    // Parse <!-- base: hash --> comment from REVIEW.md unconditionally (when present).
    let reviewBaseHash: string | undefined
    if (reviewContent !== undefined) {
      const m = reviewContent.match(/<!--\s*base:\s*([0-9a-f]{40})\s*-->/)
      if (m) reviewBaseHash = m[1]
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
    // Fallback: when HEAD is the review commit, computeReviewBase returns none
    // (frontier guard). Read the <!-- base: hash --> comment the human-review
    // agent writes into REVIEW.md so review-process can still get a base ref.
    if (computedBaseRef === undefined && reviewBaseHash !== undefined) {
      const candidateDiff = yield* git.diffRef(reviewBaseHash)
      if (candidateDiff.trim().length > 0) {
        reviewBasePresent = true
        computedBaseRef = reviewBaseHash
        refDiff = candidateDiff
      }
    }

    // Compute commitIntent and related fields.
    let commitIntent: PendingCommitIntent | undefined
    let packageCommitMsg: string | undefined
    let packageCount: number | undefined
    let specFixPending = false
    let specDiff: string | undefined
    let specReviewNumber: number | undefined

    // A "committed-unreviewed package" = packages[0] exists but has no COMMIT_MSG.md.
    // This is mutually exclusive with the execute path (which requires hasCommitMsg=true).
    const committedUnreviewedPackage = packages.length > 0 && !packages[0]!.hasCommitMsg

    if (committedUnreviewedPackage) {
      // Compute specDiff: k = trailing commits with Gtd-Spec-Review: OR Gtd-Test-Fix: trailer
      const k = countTrailing(
        messages,
        (m) => /^Gtd-Spec-Review:/m.test(m) || /^Gtd-Test-Fix:/m.test(m),
      )
      specDiff = yield* git.diffRefExcludingGtd(`HEAD~${k + 1}`)

      if (feedbackDirty !== null && feedbackHasContent) {
        // FEEDBACK.md uncommitted + content-bearing → specFixPending
        specFixPending = true
      } else if (feedbackDirty !== null && !feedbackHasContent) {
        // FEEDBACK.md uncommitted + empty/whitespace → spec-approved
        commitIntent = "spec-approved" as PendingCommitIntent
      } else if (codeDirty) {
        // codeDirty + no FEEDBACK → spec-fix; count trailing Gtd-Spec-Review only
        const trailingSpecReview = countTrailing(messages, (m) => /^Gtd-Spec-Review:/m.test(m))
        specReviewNumber = trailingSpecReview + 1
        commitIntent = "spec-fix" as PendingCommitIntent
      }
    } else if (reviewDirty === "new") {
      // human-review: a new REVIEW.md was written by the agent
      commitIntent = "human-review"
    } else if (todoEntry?.status.includes("D") && hasPackages) {
      // decompose: TODO.md was deleted AND packages exist
      commitIntent = "decompose"
      packageCount = packages.length
    } else if (codeDirty && packages.length > 0 && packages[0]!.hasCommitMsg) {
      // execute: code is dirty and lowest package has a COMMIT_MSG.md
      commitIntent = "execute"
      packageCommitMsg = yield* fs
        .readFileString(`${GTD_DIR}/${packages[0]!.name}/COMMIT_MSG.md`)
        .pipe(Effect.mapError((e) => new Error(String(e))))
    }
    // codeDirty && no packages => commitIntent left UNSET

    const payload = {
      errorsPresent,
      reviewModified,
      reviewUnmodified,
      reviewHasUncheckedBoxes,
      reviewHasRealFeedback,
      codeDirty,
      hasPackages,
      gtdDirExists,
      todoDirty,
      todoExists,
      planPhase,
      todoOpenQuestionsPresent,
      reviewPresent: reviewExists,
      reviewBasePresent,
      reviewDirty,
      agenticReviewEnabled: config.agenticReview,
      maxAgenticCycles: config.agenticReviewMaxCycles,
      specFixPending,
      lastCommitSubject,
      workingTreeClean,
      packages,
      diff,
      ...(computedBaseRef !== undefined ? { baseRef: computedBaseRef } : {}),
      ...(refDiff !== undefined ? { refDiff } : {}),
      ...(commitIntent !== undefined ? { commitIntent } : {}),
      ...(packageCommitMsg !== undefined ? { packageCommitMsg } : {}),
      ...(packageCount !== undefined ? { packageCount } : {}),
      ...(specDiff !== undefined ? { specDiff } : {}),
      ...(specReviewNumber !== undefined ? { specReviewNumber } : {}),
      ...(reviewBaseHash !== undefined ? { reviewBaseHash } : {}),
    } as unknown as ResolvePayload

    return [...commitEvents, { type: "RESOLVE", payload }] as ReadonlyArray<GtdEvent>
  })
