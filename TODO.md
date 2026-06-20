Auto-generate REVIEW.md after the build phase concludes and all tests are green.
The base ref should be whichever is **closer to HEAD**: the merge-base with the
parent branch, or the base of the last REVIEW.md that was worked through
(recorded in git history).

## Open Questions

### How does gtd know the build phase concluded with green tests? There is no state signal today.

Today the `verify` branch (src/prompts/verify.md) just tells the agent to run
tests and, on success, "report success and **STOP**. Do not re-run gtd." gtd has
no record that verification passed — the working tree is clean and the last
commit is whatever the build produced. So the next `/gtd` run would re-enter
`verify` forever, or with this feature, re-enter `review-create` forever.

We need a way to distinguish "tests passed, no review done yet" from "review
already created/processed for this state."

**Recommendation:** Detect the auto-review entry condition purely from git
state, the same way every other branch is inferred (no new persisted flag):

Enter the new `auto-review` branch when ALL of:

- working tree is clean
- no `.gtd/` directory (build is fully done)
- `TODO.md` does not exist or is not finalized → actually: TODO.md absent (a
  finalized-but-uncommitted TODO routes to decompose; a committed plan deletes
  TODO.md). Require **no TODO.md** so we only review completed builds.
- no `REVIEW.md` present
- there are commits on HEAD not yet covered by a review, i.e. the computed base
  ref (see next question) is **not** equal to HEAD (`git diff base HEAD` is
  non-empty)

This replaces the terminal `verify` step: instead of `verify` being the end of
the line, a clean tree with un-reviewed commits now routes to `auto-review`.
`verify` (running the tests) becomes a **precondition the agent performs inside
the auto-review prompt**, not a separate terminal branch — OR we keep `verify`
running tests and have its prompt re-run gtd on success (auto-advance) so the
next run lands in `auto-review`. Decide this in the "verify vs auto-review
sequencing" question below.

<!-- user answers here -->

### How is the base ref computed — "parent branch" and "last REVIEW.md base", whichever is closer?

The sketch says: base = whichever is **closer to HEAD** between (a) the parent
branch and (b) the last time a REVIEW.md was worked through in git history.

Two sub-decisions:

1. **What is the "parent branch"?** gtd is branch-agnostic today. Options:
   - the repo's default branch (`origin/HEAD` → e.g. `origin/main`), using
     `git merge-base HEAD <default>` as the candidate base.
   - a configured branch name in AGENTS.md.
   - `@{upstream}` / tracking branch.

2. **What marks "the last REVIEW.md worked through"?** The review-process flow
   commits `docs(review): process review feedback into TODO.md` and the
   review-create flow commits `review(gtd): create review for <short-hash>`
   carrying `<!-- base: <full-hash> -->`. Candidate signal: the most recent
   commit whose REVIEW.md (at that commit) carried a base, OR more simply the
   HEAD of the last review cycle. Cleanest: scan `git log` for the most recent
   `review(gtd): create review for <hash>` commit and treat **that commit
   itself** as the candidate base (everything up to and including the last
   review has already been reviewed).

3. **"Closer to HEAD"** = the candidate that is a descendant of / contains the
   other, i.e. the one with the **shorter** `git rev-list base..HEAD` count.
   When both exist, pick the one fewer commits back from HEAD. When only one
   exists, use it. When neither exists (no parent branch, no prior review), fall
   back to the root commit or the repo's first commit.

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
  ancestors → take the descendant of the two (the one that has the other in its
  history).
- If no candidate qualifies, do **not** auto-generate a review (nothing
  meaningful to review). This keeps fresh repos / linear-from-root cases quiet
  unless a parent branch is configured.

Add `mergeBase`, `defaultBranch`/`resolveDefaultBranch`, `lastReviewCommit`
(grep-based), and a `commitCount(base)` (rev-list) operation to GitService.

<!-- user answers here -->

### Sequencing: does verify still run as its own branch, or does auto-review subsume "run the tests"?

The sketch ties review generation to "all tests are green." Two designs:

A. **Two steps, auto-advancing.** Keep `verify` running the tests. On success
its prompt re-runs gtd (add it to auto-advance). The next run sees a clean tree
with un-reviewed commits and emits `auto-review`. Risk: `verify` currently ends
with "STOP. Do not re-run gtd" — must change that, and tests being green is not
a git-observable fact, so the loop relies on the agent re-running only when
tests truly passed.

B. **One step.** Fold "run tests, and only if green generate REVIEW.md" into a
single `auto-review` prompt that replaces the terminal `verify`. The prompt
instructs: run tests; on failure, diagnose+fix (the current verify discipline);
on success, compute the diff vs the provided base and write REVIEW.md. gtd
computes and passes the base ref in context.

**Recommendation:** Option B. It directly matches the sketch ("after tests are
green … generate REVIEW.md"), avoids inventing a green-tests git signal, and
keeps a single terminal state. Rename/repurpose the `verify` branch to
`auto-review`: the new prompt embeds the existing verify diagnosis discipline as
its failure path, and adds the REVIEW.md generation as its success path. gtd
supplies `baseRef` + `refDiff` (computed automatically, not from a CLI arg) in
the context. Keep the manual `gtd <ref>` review path working unchanged.

<!-- user answers here -->

### Should the auto-generated review reuse the existing review-create format/commit, and then hand off to review-process?

The existing `review-create` prompt writes `# Review: <hash>`, embeds
`<!-- base: <full-hash> -->`, formats, commits
`review(gtd): create review for <short-hash>`, then STOPs for the user. The
existing `review-process` branch already fires when a committed REVIEW.md is
later modified.

**Recommendation:** Yes — the auto-review success path produces the **same
REVIEW.md format and the same commit message** as manual `review-create`, so the
existing `review-process` branch handles the follow-up with zero changes, and
the `lastReviewCommit` detection (above) recognizes auto-generated reviews
identically to manual ones. After committing REVIEW.md, STOP (do not
auto-advance) so the user can review — same as manual review-create today.

<!-- user answers here -->

### What happens on a truly clean, fully-reviewed repo (base == HEAD)? Must avoid an infinite verify/review loop.

Once REVIEW.md is created and processed, the last-review commit advances, so the
base candidate moves toward HEAD. If after processing there are no new commits
beyond the last review and no new parent-branch divergence, base == HEAD and
there is nothing to review.

**Recommendation:** When the computed base equals HEAD (empty diff), gtd emits a
terminal "nothing to do / working tree healthy and fully reviewed" state and
does NOT emit `auto-review`. This is the new genuine end-of-loop. Decide whether
that terminal state still runs tests (a lightweight `verify`) or just reports
idle — recommend: emit a minimal `verified` prompt that runs tests once and
STOPs, preserving today's "verify the tree is healthy" behavior for
already-reviewed repos.

<!-- user answers here -->

### Does this change break the existing `verify` cucumber scenario and branch-inference tests?

`branches.feature` asserts: "Clean tree after a non-TODO commit triggers the
verify task" → `## Task: Verify the working tree is healthy`. If `verify` is
repurposed to `auto-review`, that scenario's expectation changes, because the
test project's clean-tree state would now (potentially) compute a base and emit
auto-review instead.

**Recommendation:** Update `branches.feature`: a clean tree with un-reviewed
commits + a resolvable base now emits the auto-review prompt; a clean tree with
no resolvable base (or base == HEAD) emits the residual `verified`/idle prompt.
Add new scenarios per the testing conventions in AGENTS.md (composable Given
steps, real content in scenario text). Add a Given step to set a parent/default
branch and to seed a prior `review(gtd): create review for <hash>` commit so the
"whichever is closer" selection is exercised directly.

<!-- user answers here -->

## Plan

Repurpose the terminal `verify` step into an automatic review trigger. After a
build completes (clean tree, no `.gtd/`, no `TODO.md`), gtd computes a base ref
— the commit closest to HEAD between the parent-branch merge-base and the last
review's commit — and, if there are un-reviewed changes, emits a prompt that
runs the tests and (on green) generates REVIEW.md in the existing format. The
existing manual `gtd <ref>` review path and `review-process` follow-up are
unchanged.

### 1. GitService additions (src/Git.ts, src/Git.test.ts)

- `resolveDefaultBranch()` → `origin/HEAD` short name, fallback `main`/`master`;
  fails softly (Option) when unresolvable.
- `mergeBase(a, b)` → `git merge-base`.
- `lastReviewCommit()` → most recent `review(gtd): create review for ...` commit
  hash via `git log --grep`, Option-returning.
- `commitCount(base)` → `git rev-list --count base..HEAD`.
- `isAncestor(a, b)` → `git merge-base --is-ancestor` (for "closer"/ancestor
  checks).
- Unit-test each against a temp repo, including the "closer to HEAD" selection
  given both a parent branch and a prior review commit.

### 2. Base-ref selection logic (src/State.ts)

- New helper `computeReviewBase(git)` implementing the recommendation: gather
  parent-branch merge-base and last-review candidates, drop non-ancestors, pick
  smallest `base..HEAD` count, return Option.
- Branch inference: in the clean-tree, no-`.gtd/`, no-`TODO.md` path, call
  `computeReviewBase`. If it yields a base with a non-empty diff → branch
  `auto-review` with `baseRef`/`refDiff` populated (reuse the existing refDiff
  context plumbing in Prompt.ts). Else → residual `verified` branch (runs tests,
  STOP).
- Keep the existing manual `gtd <ref>` path (`detect(refArg)`) untouched.

### 3. Branch / type wiring

- Add `auto-review` (and `verified` if kept distinct) to the `Branch` union,
  `SECTIONS` map, and prompt imports. Per AGENTS.md "Removing a Workflow Step"
  discipline, trace every reference: type def, inferStep/detect, gatherState,
  CLI dispatch (main.ts needs none beyond detect), commit-prefix mapping,
  prompts, tests, README workflow table + mermaid.

### 4. Prompts (src/prompts/)

- New `auto-review.md`: embed the failure-path diagnosis discipline from
  `verify.md`; on green, instruct generating REVIEW.md identically to
  `review-create.md` (same `<!-- base: -->` marker, same
  `review(gtd): create review for <short-hash>` commit), then STOP (no
  auto-advance).
- New `verified.md` (residual): run tests, on green report healthy + fully
  reviewed, STOP. (Or reuse verify.md.)
- Remove/repurpose `verify.md` accordingly.

### 5. Tests (tests/integration/)

- Update `branches.feature` verify scenario.
- New composable Given steps: "a default branch {string}", "a prior review
  commit for {string}", to drive base selection.
- Scenarios: parent-branch-only base; prior-review-only base; both present →
  closer one wins (assert the embedded base hash / short hash in the emitted
  prompt context); base == HEAD → residual verified prompt, no review.
- Ensure manual review.feature scenarios still pass unchanged.

### 6. Docs (README.md, SKILL.md)

- Update the state→section table, the mermaid workflow (Verify node becomes
  "auto-review if un-reviewed commits, else verified"), and the typical-feature
  walkthrough (step 8 now auto-produces REVIEW.md).
- Per global instructions: reflect every significant change in the README.

## Answered Questions
