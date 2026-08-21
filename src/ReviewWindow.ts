import { Effect, Option } from "effect"
import { GitService, type GitOperations } from "./Git.js"
import { isReviewWindowState, type StateName, type WorkflowDefinition } from "./PatternMachine.js"
import { reviewBaseFor, type ProcessRun } from "./Edge.js"
import { deleteRef, mixedResetTo, restoreStagedFrom, updateRef } from "./GitScript.js"

/**
 * The review checkout window (v3 re-introduction).
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
 * Lifecycle — driven from the program edge (`src/program.ts`), which DECIDES
 * with this module's pure/read-only halves and assembles the actual writes
 * into the two scripts a `gtd` command hands the external driver:
 *
 * - The CLOSE sequence (`decideCloseWindow` + `buildCloseWindowScript`) is
 *   read-only in this module — it decides whether a window is open and safe
 *   to close, keyed solely on `REVIEW_HEAD_REF` existing (the same
 *   reviewed-branch/legacy-containment guards described below) — and
 *   `program.ts`'s `buildRequiredScript` splices the resulting
 *   `mixedResetTo`/`deleteRef`/`deleteRef` bash in as the LEAD steps of the
 *   `required` script, ahead of the commit/squash steps themselves. Nothing
 *   reads or mutates state until the driver actually runs that script; once
 *   it does, HEAD/index are restored exactly, leaving only the reviewer's own
 *   edits dirty (captured by the resting state's own `on` patterns like any
 *   other pending change) — the pure machine never sees the window.
 * - The OPEN sequence (`decideOpenWindow` + `buildOpenWindowScript`) is
 *   likewise read-only — it self-guards on the STEP'S OWN target state
 *   declaring `reviewWindow: true` — and `program.ts`'s `openWindowScript`
 *   turns that into the `optional` script's `updateRef`/`updateRef`/
 *   `mixedResetTo`/`restoreStagedFrom` bash: saving HEAD to `REVIEW_HEAD_REF`
 *   (the base to `REVIEW_BASE_REF`), then rewinding to the base. The driver
 *   runs it AFTER the required script has already landed the new commit
 *   (`buildOpenWindowScript`'s own doc comment explains why it pins the
 *   literal string `"HEAD"`, never a resolved hash). It re-arms after
 *   read-only commands (`gtd next` / `gtd status`) and refused invocations
 *   too, so the editor's diff view stays consistent no matter which command
 *   the loop last ran.
 *
 * Every close/open sequence is idempotent under re-entry, so a crash at any
 * point is recovered by the next invocation's close (the saved ref also keeps
 * the real head GC-reachable for the window's whole lifetime).
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
 * The pre-7.2 SHARED refs. gtd never writes them any more; `decideCloseWindow`
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

/**
 * The ref pair an open window is recorded under, plus whether it is the
 * legacy shared pair. Exported so the pure close builder below and its
 * effectful "read + guard" counterpart (`decideCloseWindow`) can share the
 * exact shape `openWindowRefs`'s own guards already gather — `headHash`/
 * `legacy` are carried through even though the close SCRIPT itself (see
 * `buildCloseWindowScript`) only needs `headRef`/`baseRef`, so a caller that
 * received this record from the read half never has to re-derive it.
 */
export interface WindowRefs {
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
 * Whether a caller should run the close sequence, and (when so) the resolved
 * `WindowRefs` `buildCloseWindowScript` needs. Read-only: it reads the same
 * refs `openWindowRefs` does and runs the same two guards a close must
 * satisfy (the reviewed-branch containment check, and — for a legacy shared
 * pair — the sibling-worktree containment check), keyed on the saved-head
 * ref's existence, NOT on any config or machine state — so `program.ts`'s
 * `buildRequiredScript` can always call it first and the pure machine never
 * sees the window. Fails loudly — refs left in place — when HEAD is no longer
 * on the reviewed branch (the base is not an ancestor of HEAD, e.g. after a
 * branch switch): a mixed reset there would rewrite the wrong branch's tip.
 * Manual commits on top of the base pass the guard: the reset keeps their
 * content in the working tree, where the next turn's capture picks it up as
 * review feedback. Performs no write itself — `program.ts`'s
 * `buildRequiredScript` is the one caller, and it only splices
 * `buildCloseWindowScript`'s bash into the assembled script when
 * `shouldClose` comes back true.
 */
export type CloseWindowDecision =
  | { readonly shouldClose: false }
  | { readonly shouldClose: true; readonly refs: WindowRefs }

export const decideCloseWindow: Effect.Effect<CloseWindowDecision, Error, GitService> = Effect.gen(
  function* () {
    const git = yield* GitService
    const open = yield* openWindowRefs(git)
    if (Option.isNone(open)) return { shouldClose: false }
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

    return { shouldClose: true, refs }
  },
)

/**
 * PURE: the close sequence's bash text — reset to the saved head, then delete
 * both refs — built from `src/GitScript.ts`'s `mixedResetTo`/`deleteRef`.
 * Assumes its caller's guards (the reviewed-branch check, the legacy
 * containment check — see `decideCloseWindow`) have already passed; this
 * builder performs none of them, only the write sequence for the case where
 * they did.
 *
 * The reset target is `refs.headHash` — the RESOLVED hash, not `refs.headRef`
 * by name — precisely so the sequence stays idempotent once the ref itself is
 * gone: the very next statement deletes `headRef`, so a script naming the ref
 * for the reset would fail on re-entry (the ref `git reset --mixed` would
 * need is the one the script just deleted). A hash stays resolvable
 * regardless, so a second run's reset is a true no-op (HEAD is already
 * there) and both deletes tolerate an already-missing ref. `legacy` on `refs`
 * goes unused here — the script only needs `headRef`/`baseRef`/`headHash` —
 * but the parameter carries the whole `WindowRefs` record so a caller can
 * pass `decideCloseWindow`'s resolved `refs` straight through.
 */
export const buildCloseWindowScript = (refs: WindowRefs): string =>
  [mixedResetTo(refs.headHash), deleteRef(refs.headRef), deleteRef(refs.baseRef)].join(" &&\n")

/**
 * Whether a window should open, and at what base/head — PURE, answerable for
 * an ARBITRARY target state the caller names (not just whatever `currentRest`
 * currently resolves to), because the caller — a step about to land a commit
 * — knows the target from the matched pattern before that commit exists (see
 * `program.ts`'s `openWindowScript`, which calls this then `execScript`s
 * `buildOpenWindowScript`'s output as the `optional` script). Self-guarded,
 * exactly the shape a caller can invoke unconditionally after every state
 * subcommand: `isReviewWindowState` on the target, then `reviewBaseFor` (the
 * most-recent in-process `reviewBase` commit, or absent one the process's
 * diff base — `run.diffBase`, the process start unless a `gtd review
 * <commitish>` entry commit overrode it via a `Gtd-Review-Base:` trailer, see
 * `computeProcessRun`), then the same "no real base" / "empty process" no-op
 * checks against the prospective new head hash — when that resolves to the
 * empty tree (a process with no prior commit) or to `head` itself (an empty
 * process), there is nothing to surface and the window stays closed.
 */
export type OpenWindowDecision =
  | { readonly shouldOpen: false }
  | { readonly shouldOpen: true; readonly base: string; readonly head: string }

export const decideOpenWindow = (
  def: WorkflowDefinition,
  target: StateName,
  run: ProcessRun,
  head: string,
): OpenWindowDecision => {
  if (!isReviewWindowState(def, target)) return { shouldOpen: false }
  const base = reviewBaseFor(def, run)
  // No real base commit to rewind to (whole-history process), or an empty
  // process with nothing committed yet — nothing to surface, so stay closed.
  if (base === EMPTY_TREE || base === head) return { shouldOpen: false }
  return { shouldOpen: true, base, head }
}

/**
 * PURE: the open sequence's bash text — base-ref write, head-ref write,
 * mixed-reset-to-base, then the `.gtd/` restore-staged-from pin, built from
 * `src/GitScript.ts`'s `updateRef`/`mixedResetTo`/`restoreStagedFrom`, in the
 * same crash-safe order `openReviewWindow` uses (base ref → head ref → mixed
 * reset → `.gtd/` pin). Deliberately no `git add --intent-to-add` anywhere —
 * new files stay untracked, for the exact two reasons `openReviewWindow`'s
 * own doc comment records — and no whole-tree index write: `restoreStagedFrom`
 * is scoped to `.gtd/` alone.
 *
 * Idempotent under re-entry: `updateRef`/`mixedResetTo` re-pointing at the
 * same target is a no-op, and `restoreStagedFrom` re-pinning an already-pinned
 * path is a no-op.
 *
 * `".gtd"` stays a LITERAL, deliberately, rather than being derived from
 * states' own `file:` declarations (every one of which is compiled under
 * `.gtd/` anyway — see `PatternConfig.ts`'s `stateFile` compiler). The pin
 * exists to keep gtd's PLUMBING out of the reviewer's editor, and `.gtd/` is
 * the conventional directory it lives in — including the parts no state
 * declares (a check script's temp output), which a `file:`-derived list would
 * miss. Making the list dynamic would also cost the in-memory tier its trust
 * property — the recognizer
 * (`src/testing/EmittedScriptRecognizer.ts`'s `recognizeReviewWindowOpen`)
 * re-derives this exact string and compares, which only works while the paths
 * are fixed. Don't trade that for cosmetics.
 */
export const buildOpenWindowScript = (decision: {
  readonly base: string
  readonly head: string
}): string =>
  [
    updateRef(REVIEW_BASE_REF, decision.base),
    updateRef(REVIEW_HEAD_REF, decision.head),
    mixedResetTo(decision.base),
    restoreStagedFrom(REVIEW_HEAD_REF, [".gtd"]),
  ].join(" &&\n")
