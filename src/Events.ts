import { FileSystem } from "@effect/platform"
import { Effect, Option } from "effect"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import { TestRunner } from "./TestRunner.js"
import type { CommitEvent, EdgeAction, GtdEvent, GtdPackageFact, ResolvePayload } from "./Machine.js"

/**
 * The Effect "edge": all git/filesystem IO lives here. It has two jobs:
 *
 *  1. `gatherEvents` probes the working tree + first-parent commit history and
 *     produces the typed event stream the pure machine folds: one `COMMIT` per
 *     first-parent commit (oldest→newest) followed by a single `RESOLVE`
 *     carrying the working-tree snapshot.
 *  2. `perform` executes the `EdgeAction` the machine's `resolve()` returns
 *     (commit, revert, run tests, write steering files, …) before the driver
 *     re-gathers and re-resolves.
 *
 * The machine (src/Machine.ts) stays free of IO; this module is the only place
 * that touches git/fs.
 */

const TODO_FILE = "TODO.md"
const GTD_DIR = ".gtd"
const REVIEW_FILE = "REVIEW.md"
const FEEDBACK_FILE = "FEEDBACK.md"
const ERRORS_FILE = "ERRORS.md"
const UNANSWERED_MARKER = "<!-- user answers here -->"

// Flat `gtd: <phase>` taxonomy — the only commit subjects the machine reads or
// the edge writes. Counters fold from these prefixes + the `removedErrors` flag.
const NEW_TASK_SUBJECT = "gtd: new task"
const PLANNING_SUBJECT = "gtd: planning"
const BUILDING_SUBJECT = "gtd: building"
const ERRORS_SUBJECT = "gtd: errors"
const FEEDBACK_SUBJECT = "gtd: feedback"
const PACKAGE_DONE_SUBJECT = "gtd: package done"
const AWAITING_REVIEW_SUBJECT = "gtd: awaiting review"
const DONE_SUBJECT = "gtd: done"

// git's empty-tree object. `git diff <empty-tree> HEAD` yields the entire tree
// as additions — the Clean review base when HEAD is on the default branch and
// no prior REVIEW.md deletion exists ("else the root", STATES.md § Clean).
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const parsePorcelainPaths = (porcelain: string): ReadonlyArray<{ status: string; path: string }> =>
  porcelain
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }))

const isNumberedDir = (name: string): boolean => /^\d+-/.test(name)

/** Every `.md` under a numbered package dir is a task file now (no COMMIT_MSG.md). */
const isTaskFile = (name: string): boolean => name.endsWith(".md")

/**
 * Strip fenced code blocks and inline code spans so a marker token that appears
 * inside a code example does not count as a live open-question marker.
 */
const stripCode = (content: string): string =>
  content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[^\n]*/gm, "").replace(/`[^`\n]+`/g, "")

/**
 * Read the `.gtd/` work packages, lowest-numbered first. `packages[0]` is the
 * active one. Each numbered dir contributes its task `.md` files (sorted) and
 * their full contents.
 */
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
      packages.push({ name: dir, tasks, taskContents })
    }

    return packages
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

/**
 * Deterministic, edge-built TODO.md seed for New Feature / Accept Review. No
 * agent runs during seeding (both states list `Prompt: none`); the next
 * Grilling invocation develops this into a real plan. The captured diff is
 * fenced so any marker it contains is stripped by `stripCode` and does not trip
 * the open-question gate.
 */
export const seedTodo = (capturedDiff: string): string =>
  [
    "# Plan",
    "",
    "## Captured input",
    "",
    "These changes were captured as the starting point for this feature. Develop",
    "them into a concrete plan and surface any open questions for the user.",
    "",
    "```diff",
    capturedDiff.replace(/\n+$/, ""),
    "```",
    "",
  ].join("\n")

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

    const history = yield* git.commitHistory(Option.getOrUndefined(base))
    const commitEvents: Array<CommitEvent> = history.map(({ message, removedErrors }): CommitEvent => {
      const subject = (message.split("\n")[0] ?? "").trim()
      return {
        type: "COMMIT",
        isErrors: subject === ERRORS_SUBJECT,
        isFeedback: subject === FEEDBACK_SUBJECT,
        isPackageStart: subject === PLANNING_SUBJECT || subject === PACKAGE_DONE_SUBJECT,
        isWorkflowCommit: subject.startsWith("gtd: "),
        removedErrors,
      }
    })

    // --- RESOLVE payload (working-tree snapshot) -----------------------------
    const hasCommits = yield* git.hasCommits()
    const porcelain = hasCommits ? yield* git.statusPorcelain() : ""
    const entries = parsePorcelainPaths(porcelain)
    const workingTreeClean = entries.length === 0
    const lastCommitSubject = hasCommits ? yield* git.lastCommitSubject() : ""

    const isGtdPath = (p: string): boolean => p === GTD_DIR || p.startsWith(`${GTD_DIR}/`)
    const isSteeringFile = (p: string): boolean =>
      p === TODO_FILE || p === REVIEW_FILE || p === FEEDBACK_FILE || p === ERRORS_FILE

    // `.gtd/` package files added/edited vs the committed tree.
    const gtdModified = entries.some((e) => isGtdPath(e.path))
    // Pending changes outside the steering set (TODO/REVIEW/FEEDBACK/ERRORS/.gtd).
    const codeDirty = entries.some((e) => !isSteeringFile(e.path) && !isGtdPath(e.path))

    // Steering-file presence (committed and/or pending).
    const todoExists = yield* fs.exists(TODO_FILE)
    const gtdDirExists = yield* fs.exists(GTD_DIR)
    const reviewPresent = yield* fs.exists(REVIEW_FILE)
    const feedbackPresent = yield* fs.exists(FEEDBACK_FILE)
    const errorsPresent = yield* fs.exists(ERRORS_FILE)

    // The `<!-- user answers here -->` sentinel appears anywhere in TODO.md
    // (after stripping fenced/inline code).
    const todoContent = todoExists ? yield* fs.readFileString(TODO_FILE) : ""
    const todoMarkerPresent = todoExists && stripCode(todoContent).includes(UNANSWERED_MARKER)

    // A porcelain entry whose status flags it untracked (`?`) or freshly added
    // (`A`) is uncommitted; otherwise the file is tracked at HEAD.
    const isUncommitted = (path: string): boolean => {
      const entry = entries.find((e) => e.path === path)
      return entry !== undefined && (entry.status.includes("?") || entry.status.includes("A"))
    }

    // FEEDBACK.md: committed (Testing wrote it as `gtd: errors`) vs uncommitted
    // (Agentic Review wrote it), and whitespace-only = empty = approval.
    const feedbackCommitted = feedbackPresent && !isUncommitted(FEEDBACK_FILE)
    const feedbackContent = feedbackPresent ? yield* fs.readFileString(FEEDBACK_FILE) : ""
    const feedbackEmpty = feedbackPresent && !/\S/.test(feedbackContent)

    // REVIEW.md: committed + clean tree = approval (Done); committed + pending
    // edits (to REVIEW or any other file) = Accept Review.
    const reviewTrackedAtHead = reviewPresent && !isUncommitted(REVIEW_FILE)
    const reviewCommitted = reviewTrackedAtHead && workingTreeClean
    const reviewDirty = reviewTrackedAtHead && !workingTreeClean

    // The working tree deletes a committed ERRORS.md (human resume → fresh
    // budget). A status probe, distinct from the committed `removedErrors` flag.
    const pendingErrorsDeletion = entries.some(
      (e) => e.path === ERRORS_FILE && e.status.includes("D"),
    )

    const packages = yield* getPackages(fs)
    const diff = entries.length > 0 ? yield* git.diffHead() : ""

    // --- Review base (Clean review) ------------------------------------------
    // Two candidate bases: the merge-base with the default branch (a proper
    // ancestor on a feature branch) and the last REVIEW.md deletion (the most
    // recent completed review, on ANY branch). Pick whichever is the more recent
    // ancestor of HEAD — the deletion when it post-dates the merge-base — so a
    // finished branch review (`gtd: done` removed REVIEW.md) advances the base
    // and the next run settles in Idle instead of re-reviewing the whole branch.
    // Fall back to the root (empty tree) when neither candidate exists. Only set
    // when the diff is non-empty (non-empty distinguishes Clean from Idle).
    let reviewBase: string | undefined
    let refDiff: string | undefined
    if (hasCommits) {
      const headHash = yield* git
        .resolveRef("HEAD")
        .pipe(Effect.catchAll(() => Effect.succeed("")))
      const mergeBaseCandidate =
        Option.isSome(base) && base.value !== headHash ? base.value : undefined
      const lastDel = yield* git.lastDeletionOf(REVIEW_FILE)
      const lastDelCandidate = Option.isSome(lastDel) ? lastDel.value : undefined

      let candidate: string
      if (mergeBaseCandidate !== undefined && lastDelCandidate !== undefined) {
        // Both exist: prefer the deletion when the merge-base is its ancestor
        // (i.e. the review finished after this branch diverged).
        const mergeBaseIsOlder = yield* git.isAncestor(mergeBaseCandidate, lastDelCandidate)
        candidate = mergeBaseIsOlder ? lastDelCandidate : mergeBaseCandidate
      } else {
        candidate = mergeBaseCandidate ?? lastDelCandidate ?? EMPTY_TREE
      }
      const candidateDiff = yield* git
        .diffRef(candidate)
        .pipe(Effect.catchAll(() => Effect.succeed("")))
      if (candidateDiff.trim().length > 0) {
        reviewBase = candidate
        refDiff = candidateDiff
      }
    }

    const payload: ResolvePayload = {
      todoExists,
      gtdDirExists,
      reviewPresent,
      feedbackPresent,
      errorsPresent,
      gtdModified,
      codeDirty,
      todoMarkerPresent,
      feedbackCommitted,
      feedbackEmpty,
      feedbackContent,
      reviewCommitted,
      reviewDirty,
      pendingErrorsDeletion,
      lastCommitSubject,
      workingTreeClean,
      packages,
      diff,
      ...(reviewBase !== undefined ? { reviewBase } : {}),
      ...(refDiff !== undefined ? { refDiff } : {}),
      agenticReviewEnabled: config.agenticReview,
      fixAttemptCap: config.fixAttemptCap,
      reviewThreshold: config.reviewThreshold,
    }

    const resolveEvent: GtdEvent = { type: "RESOLVE", payload }
    return [...commitEvents, resolveEvent]
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

/**
 * Execute the side effect the machine's `resolve()` chose. The driver performs
 * this, then re-gathers + re-resolves. Each case maps to the primitives in
 * Git.ts / the FileSystem; the machine only decides *which* action.
 */
export const perform = (
  action: EdgeAction,
): Effect.Effect<void, Error, GitService | FileSystem.FileSystem | TestRunner> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem

    switch (action.kind) {
      // Transport: mixed-reset the hand-made `gtd: transport` HEAD, keeping the
      // work in the tree, then re-derive. (No producer command — consume only.)
      case "transportReset": {
        yield* git.mixedResetHead()
        return
      }

      // New Feature: capture the raw input as `gtd: new task` (unless HEAD is
      // already there — the lost-seed regenerate case), revert it back to a
      // clean baseline (inverse staged), and seed TODO.md from that diff.
      case "seedNewFeature": {
        const subject = yield* git
          .lastCommitSubject()
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        if (subject !== NEW_TASK_SUBJECT) {
          yield* git.commitAllWithPrefix(NEW_TASK_SUBJECT)
        }
        const captured = yield* git
          .diffRef("HEAD~1")
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        yield* git.revertNoCommit("HEAD")
        yield* fs.writeFileString(TODO_FILE, seedTodo(captured))
        return
      }

      // Accept Review: seed TODO.md from the human's pending changeset, discard
      // their code edits back to the reviewed baseline, and rm REVIEW.md (which
      // is what stops Accept Review re-firing). All left uncommitted.
      case "seedAcceptReview": {
        const changeset = yield* git
          .diffHead()
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        yield* git.checkoutAll()
        yield* fs.remove(REVIEW_FILE).pipe(Effect.catchAll(() => Effect.void))
        yield* fs.writeFileString(TODO_FILE, seedTodo(changeset))
        return
      }

      // Testing: commit the pending tree `gtd: building` (nothing pending in the
      // no-op-fixer case), run tests; on red write FEEDBACK (below cap) or ERRORS
      // (at cap) and commit `gtd: errors`; on green proceed.
      case "runTest": {
        const runner = yield* TestRunner
        const status = yield* git.statusPorcelain()
        // A clean tree means nothing was committed as `gtd: building` below — the
        // only such entry into Testing is the no-op fixer (clean tree, HEAD
        // `gtd: fixing`).
        const committedBuilding = status.trim().length > 0
        if (committedBuilding) {
          yield* git.commitAllWithPrefix(BUILDING_SUBJECT)
        }
        const result = yield* runner.run()
        if (result.exitCode === 0) {
          // No-op-fixer green re-test: nothing was committed above, so HEAD is
          // still `gtd: fixing`; gather→resolve would re-detect Testing forever.
          // Commit an empty `gtd: building` to advance HEAD off `gtd: fixing` so
          // the next resolve reaches Agentic Review (STATES.md § Testing "green →
          // proceed"). The normal green path already committed `gtd: building`.
          if (!committedBuilding) {
            yield* git.commitAllWithPrefix(BUILDING_SUBJECT)
          }
          return
        }
        const target = action.capReached ? ERRORS_FILE : FEEDBACK_FILE
        yield* fs.writeFileString(target, result.output)
        yield* git.commitAllWithPrefix(ERRORS_SUBJECT)
        return
      }

      // Grilling / Grilled / Planning / Fixing: commit the pending tree under a
      // fixed phase prefix. Fixing sets `removeFeedback` so FEEDBACK.md's removal
      // lands in the `gtd: fixing` / `gtd: feedback` commit — otherwise the next
      // run re-detects FEEDBACK (precedence 2) and Fixing re-fires forever instead
      // of returning to Testing (STATES.md § Fixing).
      case "commitPending": {
        if (action.removeFeedback === true) {
          yield* fs.remove(FEEDBACK_FILE).pipe(Effect.catchAll(() => Effect.void))
        }
        if (action.removeTodo === true) {
          yield* fs.remove(TODO_FILE).pipe(Effect.catchAll(() => Effect.void))
        }
        yield* git.commitAllWithPrefix(action.prefix)
        return
      }

      // Close package: remove the (maybe-empty / maybe-absent) FEEDBACK.md, rm
      // the first (finished) package dir (+ the now-empty `.gtd/`), commit
      // `gtd: package done`. Tolerates an absent FEEDBACK.md (force-approve).
      case "closePackage": {
        yield* fs.remove(FEEDBACK_FILE).pipe(Effect.catchAll(() => Effect.void))
        const packages = yield* getPackages(fs)
        const first = packages[0]
        if (first !== undefined) {
          yield* git.removePackageDir(`${GTD_DIR}/${first.name}`)
        }
        yield* git.commitAllWithPrefix(PACKAGE_DONE_SUBJECT)
        return
      }

      // Await Review: commit REVIEW.md as `gtd: awaiting review`.
      case "commitReview": {
        yield* git.commitAllWithPrefix(AWAITING_REVIEW_SUBJECT)
        return
      }

      // Done: rm REVIEW.md, commit `gtd: done`.
      case "done": {
        yield* fs.remove(REVIEW_FILE).pipe(Effect.catchAll(() => Effect.void))
        yield* git.commitAllWithPrefix(DONE_SUBJECT)
        return
      }
    }
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))
