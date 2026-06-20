Auto-generate REVIEW.md after the build phase concludes and all tests are green.
The base ref should be whichever is **closer to HEAD**: the merge-base with the
parent branch, or the base of the last REVIEW.md that was worked through
(recorded in git history).

## Plan

Add a new terminal **`human-review`** workflow step that follows `verify` on
success. `verify` keeps running the tests; when they pass and the tree has
un-reviewed commits, the run advances to `human-review`, which computes a base
ref — the commit closest to HEAD between the parent-branch merge-base and the
last review's commit — and generates REVIEW.md in the existing `review-create`
format (same `<!-- base: -->` marker, same
`review(gtd): create review for <short-hash>` commit), then STOPs for the user.
When there is nothing to review (no resolvable base, or base == HEAD), the run
stays in a minimal `verified` terminal state that runs tests once and STOPs. The
existing manual `gtd <ref>` review path and `review-process` follow-up are
unchanged.

This is **adding a step** to the linear workflow, so per the AGENTS.md "Removing
a Workflow Step" discipline (in reverse) every reference must be traced and
wired: step type, `inferStep`/`detect` logic, `gatherState` inputs, CLI
dispatch, commit-prefix recognition, config/prompts, and all tests.

> Note on commit prefixes / backward compat: branch inference here is driven by
> **git + filesystem state**, not by parsing the last commit subject
> (`lastCommitSubject` is informational context only). The `human-review` commit
> reuses the existing `review(gtd): create review for <hash>` message, which
> `lastReviewCommit` greps for. So no new commit prefix is introduced and there
> is no history-compatibility risk — auto-generated and manual reviews are
> indistinguishable to `lastReviewCommit`.

### 1. GitService additions (src/Git.ts, src/Git.test.ts)

- `resolveDefaultBranch()` → `origin/HEAD` short name via
  `git rev-parse --abbrev-ref origin/HEAD`, fallback `main`/`master`; fails
  softly (Option) when unresolvable (no remote, detached).
- `mergeBase(a, b)` → `git merge-base a b`.
- `lastReviewCommit()` → hash of the most recent
  `review(gtd): create review for ...` commit via `git log --grep`,
  Option-returning.
- `commitCount(base)` → `git rev-list --count base..HEAD`.
- `isAncestor(a, b)` → `git merge-base --is-ancestor` (for "closer"/ancestor
  checks).
- Unit-test each against a temp repo, including the "closer to HEAD" selection
  given both a parent branch and a prior review commit.

### 2. Base-ref selection logic (src/State.ts)

- New helper `computeReviewBase(git)`: gather the parent-branch merge-base and
  last-review candidates, drop any that are not ancestors of HEAD, pick the one
  with the **smallest** `base..HEAD` count (closest to HEAD); on a tie take the
  descendant of the two. Return Option — none when no candidate qualifies.

### 3. Step type and inference (src/State.ts)

- Add `"human-review"` and `"verified"` to the `Branch` union (alongside
  `"verify"`).
- In the clean-tree, no-`.gtd/`, no-`TODO.md` path (currently the `verify`
  branch): keep emitting `verify` first. `verify`'s prompt re-runs gtd on
  success (Option A: separate auto-advancing steps).
- On the **next** run (clean tree, tests already green), inference calls
  `computeReviewBase`:
  - base present **and** `git diff base HEAD` non-empty → emit `human-review`
    with `baseRef`/`refDiff` populated (reuse the existing `refDiff` context
    plumbing in Prompt.ts).
  - otherwise (no base, or base == HEAD) → emit `verified` (residual: run tests,
    STOP).
- Keep the existing manual `gtd <ref>` path (`detect(refArg)`) untouched.

  > Sequencing detail (Option A): `verify` and `human-review` are **two distinct
  > steps**. `verify` runs the tests; `human-review` follows it on success.
  > Tests being green is not a git-observable fact, so the advance from `verify`
  > → `human-review` relies on `verify`'s prompt re-running gtd only after the
  > suite truly passes. The boundary between "verify just ran" and "human-review
  > pending" is that `human-review` is only emitted when `computeReviewBase`
  > yields a base with a non-empty diff.

### 4. Branch / type wiring (trace every reference)

Per the AGENTS.md add-a-step discipline:

- `Branch` union (src/State.ts) — `human-review`, `verified`.
- `SECTIONS` map + prompt imports (src/Prompt.ts).
- `AUTO_ADVANCE_BRANCHES` (src/Prompt.ts): add `verify` (so it advances into
  `human-review` on success). `human-review` and `verified` are **terminal** —
  do NOT add them (they STOP).
- `detect`/inference (src/State.ts).
- CLI dispatch (src/main.ts — verify via `detect`, no new dispatch needed).
- Commit-prefix recognition: none new (reuses `review(gtd): create review`).
- Config schema (if a configurable default-branch override is added).
- Prompts (src/prompts/).
- Tests + README/SKILL docs.

### 5. Prompts (src/prompts/)

- Keep `verify.md` running the tests; change its happy path from "STOP, do not
  re-run gtd" to **auto-advance** (re-run gtd on green) so the next run reaches
  `human-review`. Its failure-path diagnosis discipline stays.
- New `human-review.md`: generate REVIEW.md identically to `review-create.md`
  (same `# Review: <short-hash>` heading, same `<!-- base: <full-hash> -->`
  marker, same `review(gtd): create review for <short-hash>` commit, run
  `gtd format REVIEW.md`), then STOP — no auto-advance, so the existing
  `review-process` branch handles the follow-up with zero changes. (Can share
  body with `review-create.md` via a partial.)
- New `verified.md` (residual): run tests, on green report "working tree healthy
  and fully reviewed", STOP.

### 6. Tests (tests/integration/)

- Update `branches.feature` verify scenario: a clean tree after a non-TODO
  commit emits `verify` (now auto-advancing); the follow-up run with a
  resolvable base + un-reviewed commits emits the `human-review` prompt; with no
  resolvable base or base == HEAD emits the residual `verified` prompt.
- New composable Given steps (per AGENTS.md: small, reusable, real content in
  scenario text, one commit per step): "a default branch {string}", "a prior
  review commit for {string}".
- Scenarios: parent-branch-only base; prior-review-only base; both present →
  closer one wins (assert the embedded base hash / short hash in the emitted
  prompt context); base == HEAD → residual verified prompt, no review.
- Ensure existing manual `review.feature` scenarios still pass unchanged.

### 7. Docs (README.md, SKILL.md)

- Update the state→section table (rows around README.md:50/53), the mermaid
  workflow (README.md:83 — the `Verify` node now advances to a `human-review`
  node when un-reviewed commits exist, else terminates at `verified`), and the
  typical-feature walkthrough so it shows the post-verify step auto-producing
  REVIEW.md.
- Per global instructions: reflect every significant change in the README.

## Answered Questions

### How does gtd know the build phase concluded with green tests? There is no state signal today.

**Recommendation:** Detect the human-review entry condition purely from git
state, the same way every other branch is inferred (no new persisted flag). With
Option A, `verify` runs first and auto-advances on green; the follow-up run,
seeing a clean tree with no `.gtd/`, no `TODO.md`, no `REVIEW.md`, and a
resolvable base whose `git diff base HEAD` is non-empty, routes to
`human-review`.

**Answer:** agree, but do not call it auto-review, but human-review.

### How is the base ref computed — "parent branch" and "last REVIEW.md base", whichever is closer?

**Recommendation:**

- Parent branch = default branch resolved via
  `git rev-parse --abbrev-ref origin/HEAD` (fallback `main`, then `master`),
  candidate base = `git merge-base HEAD <default>`. If resolution fails (no
  remote, detached), skip this candidate.
- Last-review candidate = commit hash of the most recent
  `review(gtd): create review for ...` commit found via `git log --grep`. Skip
  if none.
- Pick the candidate that is an **ancestor of HEAD** with the **smallest**
  `rev-list <candidate>..HEAD` commit count (closest to HEAD). Tie / both
  ancestors → take the descendant of the two.
- If no candidate qualifies, do **not** auto-generate a review.

Add `mergeBase`, `defaultBranch`/`resolveDefaultBranch`, `lastReviewCommit`
(grep-based), `commitCount(base)` (rev-list), and `isAncestor` to GitService.

**Answer:** agreed.

### Sequencing: does verify still run as its own branch, or does human-review subsume "run the tests"?

**Recommendation:** (originally Option B — one step). Superseded by the answer.

**Answer:** A, go with separate steps. `verify` stays a distinct step that runs
the tests and auto-advances on green; `human-review` is a NEW step that follows
`verify` on success.

### Should the auto-generated review reuse the existing review-create format/commit, and then hand off to review-process?

**Recommendation:** Yes — the `human-review` success path produces the **same
REVIEW.md format and the same commit message** as manual `review-create`, so the
existing `review-process` branch handles the follow-up with zero changes, and
`lastReviewCommit` detection recognizes auto-generated reviews identically to
manual ones. After committing REVIEW.md, STOP (no auto-advance).

**Answer:** agreed.

### What happens on a truly clean, fully-reviewed repo (base == HEAD)? Must avoid an infinite verify/review loop.

**Recommendation:** When the computed base equals HEAD (empty diff) or no base
resolves, gtd emits a terminal `verified` prompt that runs tests once and STOPs,
preserving today's "verify the tree is healthy" behavior for already-reviewed
repos. It does NOT emit `human-review`.

**Answer:** agreed.

### Does this change break the existing `verify` cucumber scenario and branch-inference tests?

**Recommendation:** Update `branches.feature`: a clean tree with un-reviewed
commits + a resolvable base now (after verify auto-advances) emits the
`human-review` prompt; a clean tree with no resolvable base (or base == HEAD)
emits the residual `verified` prompt. Add new scenarios per the testing
conventions in AGENTS.md (composable Given steps, real content in scenario
text). Add Given steps to set a default branch and to seed a prior
`review(gtd): create review for <hash>` commit so the "whichever is closer"
selection is exercised directly.

**Answer:** agreed.
