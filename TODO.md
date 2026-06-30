# Plan

no open questions — run gtd to plan

## Issue 7: loop budgets always 0 on the default branch

`fixAttemptCap` / `reviewThreshold` budgets never engage on a trunk-based
workflow. On the default branch `merge-base(defaultBranch, HEAD) == HEAD`, so
the COMMIT stream range `base..HEAD` is empty, `commitHistory` returns `[]`, and
`foldCounters([])` yields `{testFixCount: 0, reviewFixCount: 0}`. Both budgeted
loops are disabled for any repo that does its gtd work on the default branch.

### Root cause

`src/Events.ts:204-208` (gatherEvents, COMMIT-events section):

```ts
const base = Option.isSome(defaultBranch)
  ? yield * git.mergeBase(defaultBranch.value, "HEAD")
  : Option.none<string>()
const history = yield * git.commitHistory(Option.getOrUndefined(base))
```

When HEAD _is_ on the default branch, `merge-base(main, HEAD)` is HEAD's own
hash. `commitHistory("HEAD")` runs `git log HEAD..HEAD` → empty. The counter
fold then sees no COMMIT events.

This is the same trap the **reviewBase** logic already guards against a few
lines down (`src/Events.ts:300-302`): it resolves HEAD's hash and only treats
the merge-base as a candidate when `base.value !== headHash`.

### Why the whole-history fallback is correct (not just convenient)

`foldCounters` (`src/Machine.ts:240-251`) resets both counters on every package
boundary — `isPackageStart` (`gtd: planning` / `gtd: package done`),
`isFeedback`, and `removedErrors`. So widening the COMMIT range to the full
first-parent history **cannot inflate** the counts: the most recent boundary
clamps them. Whole-history (`base = undefined`) is already the documented
fallback for the no-default-branch / no-merge-base case (`src/Events.ts:201`,
`Git.ts:167-198`). On a feature branch the merge-base is a proper ancestor and
stays the (cheaper, correct) base; only the degenerate HEAD==merge-base case
falls back.

### The fix

In `gatherEvents`, mirror the reviewBase guard: discard the merge-base when it
equals HEAD, so the range falls back to whole-history.

`src/Events.ts` — change the base resolution so that when the merge-base equals
the HEAD hash it is treated as absent:

```ts
const defaultBranch = yield * git.resolveDefaultBranch()
const headHash =
  yield * git.resolveRef("HEAD").pipe(Effect.catchAll(() => Effect.succeed("")))
const mergeBase = Option.isSome(defaultBranch)
  ? yield * git.mergeBase(defaultBranch.value, "HEAD")
  : Option.none<string>()
// Discard the merge-base when it is HEAD itself (trunk-based workflow): the
// range main..HEAD would be empty and disable the budgets. Whole-history
// fallback is safe because foldCounters resets on every package boundary.
const base =
  Option.isSome(mergeBase) && mergeBase.value !== headHash
    ? mergeBase
    : Option.none<string>()
const history = yield * git.commitHistory(Option.getOrUndefined(base))
```

Notes:

- `resolveRef("HEAD")` already exists (`Git.ts:101-109`); the reviewBase block
  below resolves the same `headHash` independently. Resolve it once at the top
  of the COMMIT section and reuse it in the reviewBase block (lines 300-302) to
  avoid the duplicate `resolveRef` call. Keep the existing `catchAll(() => "")`
  guard for the empty-repo (no HEAD) case.
- `headHash === ""` (empty repo) never equals a real merge-base, so the guard is
  inert there — `commitHistory` already returns `[]` for a repo with no HEAD.

### Tests

Existing budget scenarios in `tests/integration/features/testing.feature`
(escalate-at-cap, errors-reset) all run on a **feature** branch
(`Given a branch "feature"`), which is exactly why the bug slipped through —
they never exercise the trunk case. Add trunk-based coverage:

- **Cucumber (primary):** add a scenario to `testing.feature` that builds the
  same fix-attempt-cap escalation **without** the `Given a branch "feature"`
  step — i.e. all `gtd: errors` commits land on the default branch. Reuse the
  existing composable Given steps: `Given a default branch "main"` plus whatever
  step appends the `gtd: errors` commits the other cap scenarios already use; do
  not add a branch step. Assert the run reaches Escalate (ERRORS.md written) at
  the cap, proving the budget folds over trunk commits. Add a parallel
  trunk-based scenario for the review-fix threshold in `agentic-review.feature`
  (or `review.feature`) mirroring its existing feature-branch budget scenario.
  Step text must expose the actual commits, per AGENTS.md.
- **Unit (regression on the exact bug):** add a case to the
  `gatherEvents — review base` neighbourhood in `src/Events.test.ts` (new
  `describe` for the COMMIT stream base): on the default branch with N
  `gtd: errors` commits after a `gtd: planning`, assert the resolved
  `testFixCount` (or the COMMIT event count) is N, not 0. A feature-branch
  control case asserts the merge-base range still scopes correctly (commits
  before the branch point are excluded).

### Out of scope / non-goals

- No change to `commitHistory`, `mergeBase`, `foldCounters`, the reset triggers,
  or the precedence ladder. The merge-base remains the base on feature branches.
- No config-schema change; `fixAttemptCap` / `reviewThreshold` semantics are
  unchanged — they simply start working on trunk.

### README

Per global instructions, reflect the fix if the README documents the
counter/merge-base base behavior. Check `README.md` for any "feature branch" /
merge-base wording on budgets and note that budgets now also engage on the
default branch (whole-history fallback when HEAD is the merge-base).
