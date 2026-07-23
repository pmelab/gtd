import { Effect, Option } from "effect"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import {
  isReviewBaseState,
  isReviewWindowState,
  parseStateSubject,
  resolveState,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { computeProcessRun, type ProcessRun } from "./Edge.js"
import type { GitOperations } from "./Git.js"

/**
 * The review checkout window (v3 re-introduction — see
 * `docs/design/pattern-machine-plan.md`'s follow-up note and STATES.md §11).
 * While a process RESTS at a state declaring `reviewWindow: true` (the
 * bundled default's `await-review`), HEAD and the index are temporarily
 * rewound to the review base with the working tree untouched, so the entire
 * `base..HEAD` diff surfaces as ordinary uncommitted changes in any editor's
 * standard git integration (SCM panel, gutters, per-file diffs, discard-hunk).
 *
 * v2 hard-wired this to a single `awaiting-review` gate; v3 drives it purely
 * from the DECLARATIVE `reviewWindow`/`reviewBase` state properties (see
 * `PatternMachine.StateDef`) — the pure engine never observes an open window,
 * exactly as before.
 *
 * Lifecycle — driven from the program edge (`src/program.ts`), bracketing
 * every state subcommand:
 *
 * - `closeReviewWindow` runs BEFORE anything reads or mutates state, keyed
 *   solely on `refs/gtd/review-head` existing: `git reset --mixed
 *   refs/gtd/review-head` restores HEAD/index exactly, leaving only the
 *   reviewer's own edits dirty (captured by the resting state's own `on`
 *   patterns like any other pending change). The pure machine therefore never
 *   sees the window.
 * - `openReviewWindow` runs AFTER the subcommand finishes and self-guards on
 *   the resolved rest declaring `reviewWindow: true`: it saves HEAD to
 *   `refs/gtd/review-head` (the base to `refs/gtd/review-base`), then `git
 *   reset --mixed <base>`. It re-arms after read-only commands (`gtd next` /
 *   `gtd status`) and refused invocations too, so the editor's diff view stays
 *   consistent no matter which command the loop last ran.
 *
 * Every open/close step is idempotent under re-entry, so a crash at any point
 * is recovered by the next invocation's close (the saved ref also keeps the
 * real head GC-reachable for the window's whole lifetime).
 */

export const REVIEW_HEAD_REF = "refs/gtd/review-head"
export const REVIEW_BASE_REF = "refs/gtd/review-base"

// git's empty-tree object — `computeProcessRun`'s `startParentHash` when a
// process covers the whole history with no earlier commit. There is no real
// commit to rewind to, so the window simply does not open in that case.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const subjectOf = (message: string): string => (message.split("\n")[0] ?? "").trim()

/**
 * The diff base while the window is open: the hash of the most-recent
 * in-process turn commit that ENTERED a `reviewBase` state, or `undefined`
 * when the workflow declares no such state (the caller then falls back to the
 * process start). Walks the current process run's commits (oldest→newest, via
 * `commitHistory(startParentHash)`), so it never reaches across the process
 * boundary into a previous cycle.
 */
export const reviewBaseHash = (
  git: GitOperations,
  def: WorkflowDefinition,
  run: ProcessRun,
): Effect.Effect<string | undefined, Error> =>
  Effect.gen(function* () {
    const history = yield* git.commitHistory(run.startParentHash)
    let base: string | undefined
    for (const commit of history) {
      const parsed = parseStateSubject(subjectOf(commit.message))
      if (parsed !== undefined && isReviewBaseState(def, parsed.state)) base = commit.hash
    }
    return base
  })

/**
 * Restore the real head if a review checkout window is open; no-op otherwise.
 * Keyed on `refs/gtd/review-head` existence, NOT on any config or machine
 * state, so it always runs first and the machine never sees the window.
 *
 * Fails loudly — refs left in place — when HEAD is no longer on the reviewed
 * branch (the base is not an ancestor of HEAD, e.g. after a branch switch): a
 * mixed reset there would rewrite the wrong branch's tip. Manual commits on
 * top of the base pass the guard: the reset keeps their content in the working
 * tree, where the next turn's capture picks it up as review feedback.
 */
export const closeReviewWindow: Effect.Effect<{ readonly closed: boolean }, Error, GitService> =
  Effect.gen(function* () {
    const git = yield* GitService
    const savedHead = yield* git.readRefOption(REVIEW_HEAD_REF)
    if (Option.isNone(savedHead)) return { closed: false }

    const base = yield* git.readRefOption(REVIEW_BASE_REF)
    if (Option.isSome(base) && base.value !== EMPTY_TREE) {
      const onReviewedBranch = yield* git.isAncestor(base.value, "HEAD")
      if (!onReviewedBranch) {
        return yield* Effect.fail(
          new Error(
            "a gtd review checkout window is open but HEAD has moved off the reviewed branch — " +
              "return to it, or restore manually with " +
              "`git reset --mixed refs/gtd/review-head && git update-ref -d refs/gtd/review-head && git update-ref -d refs/gtd/review-base`",
          ),
        )
      }
    }

    yield* git.mixedResetTo(REVIEW_HEAD_REF)
    yield* git.deleteRef(REVIEW_HEAD_REF)
    yield* git.deleteRef(REVIEW_BASE_REF)
    return { closed: true }
  })

/**
 * Open (or re-arm) the review checkout window. Self-guarded: a no-op unless
 * the resolved rest's state declares `reviewWindow: true` and a distinct base
 * commit exists, so the caller invokes it unconditionally after every state
 * subcommand.
 *
 * The base is the most-recent in-process `reviewBase` commit
 * (`reviewBaseHash`) or, absent any such state, the process start
 * (`startParentHash`). When that resolves to the empty tree (a process with no
 * prior commit) or to HEAD itself (an empty process), there is nothing to
 * surface and the window stays closed.
 *
 * Ordering is crash-safe: base ref → head ref → mixed reset → `.gtd/` index
 * pin → intent-to-add. A crash before the head-ref write leaves only a stale
 * base ref (overwritten on the next open); a crash after it leaves HEAD ==
 * review-head, which the next invocation's close restores as a no-op.
 */
export const openReviewWindow: Effect.Effect<
  { readonly opened: boolean },
  Error,
  GitService | ConfigService
> = Effect.gen(function* () {
  const git = yield* GitService
  const config = yield* ConfigService
  const def = config.workflow

  const hasCommits = yield* git.hasCommits()
  if (!hasCommits) return { opened: false }

  const headSubject = yield* git.lastCommitSubject()
  const state = resolveState(def, headSubject)
  if (!isReviewWindowState(def, state)) return { opened: false }

  const run = yield* computeProcessRun(git, def)
  const explicitBase = yield* reviewBaseHash(git, def, run)
  const base = explicitBase ?? run.startParentHash
  const headHash = yield* git.resolveRef("HEAD")
  // No real base commit to rewind to (whole-history process), or an empty
  // process with nothing committed yet — nothing to surface, so stay closed.
  if (base === EMPTY_TREE || base === headHash) return { opened: false }

  yield* git.updateRef(REVIEW_BASE_REF, base)
  yield* git.updateRef(REVIEW_HEAD_REF, headHash)
  yield* git.mixedResetTo(base)
  // `.gtd/` (REVIEW.md, plan/feedback files) is workflow plumbing, not part of
  // the reviewable diff — pin its index entries back to the saved head so the
  // editor's unstaged view shows only the code changes.
  yield* git.restoreStagedFrom(REVIEW_HEAD_REF, [".gtd"])
  // Files added since the base would otherwise show as untracked; register
  // them so editors render proper content diffs (and "discard" stays a
  // coherent reject-this-file gesture).
  yield* git.addIntentToAdd()
  return { opened: true }
})
