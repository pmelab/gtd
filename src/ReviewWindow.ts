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
 *   solely on `REVIEW_HEAD_REF` existing: `git reset --mixed <that ref>`
 *   restores HEAD/index exactly, leaving only the reviewer's own edits dirty
 *   (captured by the resting state's own `on` patterns like any other pending
 *   change). The pure machine therefore never sees the window.
 * - `openReviewWindow` runs AFTER the subcommand finishes and self-guards on
 *   the resolved rest declaring `reviewWindow: true`: it saves HEAD to
 *   `REVIEW_HEAD_REF` (the base to `REVIEW_BASE_REF`), then `git reset --mixed
 *   <base>`. It re-arms after read-only commands (`gtd next` / `gtd status`)
 *   and refused invocations too, so the editor's diff view stays consistent no
 *   matter which command the loop last ran.
 *
 * Every open/close step is idempotent under re-entry, so a crash at any point
 * is recovered by the next invocation's close (the saved ref also keeps the
 * real head GC-reachable for the window's whole lifetime).
 */

/**
 * The window's two state refs live in git's PER-WORKTREE `refs/worktree/*`
 * namespace, so linked worktrees sharing one `.git` (`git worktree add`) each
 * get their OWN window: a review resting in one worktree is invisible to — and
 * un-clobberable by — every other one, and git drops the refs with the
 * worktree.
 *
 * gtd ≤ 7.1 kept them in the SHARED `refs/gtd/*` namespace (the legacy names
 * below), which made a second worktree's very first gtd invocation close the
 * FIRST worktree's window: its `git reset --mixed` moved the second worktree's
 * branch onto the other worktree's saved head, and every later invocation
 * refused with "a process is already underway" (issue #118).
 */
export const REVIEW_HEAD_REF = "refs/worktree/gtd/review-head"
export const REVIEW_BASE_REF = "refs/worktree/gtd/review-base"

/**
 * The pre-7.2 SHARED refs. gtd never writes them any more; `closeReviewWindow`
 * only reads them to finish a window an older gtd left open across the upgrade
 * — and only when HEAD is still contained in the saved head, since a shared ref
 * may belong to a sibling worktree (see `openWindowRefs`).
 */
export const LEGACY_REVIEW_HEAD_REF = "refs/gtd/review-head"
export const LEGACY_REVIEW_BASE_REF = "refs/gtd/review-base"

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

/** The ref pair an open window is recorded under, plus whether it is the legacy shared pair. */
interface WindowRefs {
  readonly headRef: string
  readonly baseRef: string
  readonly headHash: string
  readonly legacy: boolean
}

/** The manual-recovery incantation every close refusal ends with. */
const manualRecovery = (refs: WindowRefs): string =>
  `\`git reset --mixed ${refs.headRef} && git update-ref -d ${refs.headRef} && ` +
  `git update-ref -d ${refs.baseRef}\``

/**
 * Which ref pair (if any) records an open window: this worktree's own
 * `refs/worktree/gtd/*` pair first, falling back to the pre-7.2 shared
 * `refs/gtd/*` pair so an upgrade mid-window still closes cleanly.
 */
const openWindowRefs = (git: GitOperations): Effect.Effect<Option.Option<WindowRefs>, Error> =>
  Effect.gen(function* () {
    const scoped = yield* git.readRefOption(REVIEW_HEAD_REF)
    if (Option.isSome(scoped)) {
      return Option.some({
        headRef: REVIEW_HEAD_REF,
        baseRef: REVIEW_BASE_REF,
        headHash: scoped.value,
        legacy: false,
      })
    }
    const legacy = yield* git.readRefOption(LEGACY_REVIEW_HEAD_REF)
    if (Option.isNone(legacy)) return Option.none()
    return Option.some({
      headRef: LEGACY_REVIEW_HEAD_REF,
      baseRef: LEGACY_REVIEW_BASE_REF,
      headHash: legacy.value,
      legacy: true,
    })
  })

/**
 * Restore the real head if a review checkout window is open; no-op otherwise.
 * Keyed on the saved-head ref's existence (see `openWindowRefs`), NOT on any
 * config or machine state, so it always runs first and the machine never sees
 * the window.
 *
 * Fails loudly — refs left in place — when HEAD is no longer on the reviewed
 * branch (the base is not an ancestor of HEAD, e.g. after a branch switch): a
 * mixed reset there would rewrite the wrong branch's tip. Manual commits on
 * top of the base pass the guard: the reset keeps their content in the working
 * tree, where the next turn's capture picks it up as review feedback.
 *
 * A window found under the LEGACY shared refs gets one extra guard: a shared
 * ref may have been written by a sibling worktree, so the close only proceeds
 * when HEAD is contained in the saved head — the shape a window this worktree
 * opened itself has. Anything else refuses with the manual recovery rather
 * than resetting this branch onto another worktree's work (issue #118).
 */
export const closeReviewWindow: Effect.Effect<{ readonly closed: boolean }, Error, GitService> =
  Effect.gen(function* () {
    const git = yield* GitService
    const open = yield* openWindowRefs(git)
    if (Option.isNone(open)) return { closed: false }
    const refs = open.value

    const base = yield* git.readRefOption(refs.baseRef)
    if (Option.isSome(base) && base.value !== EMPTY_TREE) {
      const onReviewedBranch = yield* git.isAncestor(base.value, "HEAD")
      if (!onReviewedBranch) {
        return yield* Effect.fail(
          new Error(
            "a gtd review checkout window is open but HEAD has moved off the reviewed branch — " +
              `return to it, or restore manually with ${manualRecovery(refs)}`,
          ),
        )
      }
    }

    if (refs.legacy) {
      const ownsWindow = yield* git.isAncestor("HEAD", refs.headHash)
      if (!ownsWindow) {
        return yield* Effect.fail(
          new Error(
            `a review checkout window is recorded under the shared ${LEGACY_REVIEW_HEAD_REF} ` +
              "(written by gtd 7.1 or older) but it does not belong to this worktree — HEAD is " +
              "not contained in it. gtd now scopes the window per worktree " +
              `(${REVIEW_HEAD_REF}); in the worktree that owns it, run ${manualRecovery(refs)}`,
          ),
        )
      }
    }

    yield* git.mixedResetTo(refs.headRef)
    yield* git.deleteRef(refs.headRef)
    yield* git.deleteRef(refs.baseRef)
    return { closed: true }
  })

/**
 * Open (or re-arm) the review checkout window. Self-guarded: a no-op unless
 * the resolved rest's state declares `reviewWindow: true` and a distinct base
 * commit exists, so the caller invokes it unconditionally after every state
 * subcommand.
 *
 * The base is the most-recent in-process `reviewBase` commit
 * (`reviewBaseHash`) or, absent any such state, the process's diff base
 * (`run.diffBase` — the process start, `startParentHash`, unless a
 * `gtd review <commitish>` entry commit overrode it via a `Gtd-Review-Base:`
 * trailer, see `computeProcessRun`). When that resolves to the empty tree (a
 * process with no prior commit) or to HEAD itself (an empty process), there
 * is nothing to surface and the window stays closed.
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
  const config = yield* (yield* ConfigService).load
  const def = config.workflow

  const hasCommits = yield* git.hasCommits()
  if (!hasCommits) return { opened: false }

  const headSubject = yield* git.lastCommitSubject()
  const state = resolveState(def, headSubject)
  if (!isReviewWindowState(def, state)) return { opened: false }

  const run = yield* computeProcessRun(git, def)
  const explicitBase = yield* reviewBaseHash(git, def, run)
  const base = explicitBase ?? run.diffBase
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
