# Add composable Given steps for review-base scenarios

Add two new reusable `Given` steps so feature scenarios can seed a default
branch and a prior review commit, exercising the "whichever is closer to HEAD"
base selection.

## Files

- `tests/integration/support/steps/common.steps.ts` (preferred — these are
  generic), or a new `review-base.steps.ts` if you prefer to keep them grouped.
  Cucumber loads all of `tests/integration/support/**/*.ts`.

## Steps to add

Follow AGENTS.md: small, reusable, real content in scenario text, one commit (or
one git mutation) per step. Use the existing
`execFileSync("git", [...], { cwd: this.repoDir })` pattern already used in
`common.steps.ts`.

1. `Given("a default branch {string}", function (this: GtdWorld, branch: string) {...})`
   - Make the repo's default branch resolvable as `branch` so
     `resolveDefaultBranch()` returns it. The test repos have no remote, so the
     `origin/HEAD` path won't apply; instead ensure a local branch named
     `branch` exists (e.g. `git branch -M <branch>` or
     `git checkout -b <branch>`), which the `main`/`master` fallback in
     `resolveDefaultBranch` resolves. Document in a comment which resolution
     path this exercises.
   - If a scenario needs a divergent feature branch off the default branch (so a
     merge-base exists strictly behind HEAD), pair this with the existing
     `a commit ... that adds ...` steps; do not bake branching into this step
     beyond setting/naming the default branch.

2. `Given("a prior review commit for {string}", function (this: GtdWorld, shortHash: string) {...})`
   - Create a commit whose subject is exactly
     `review(gtd): create review for <shortHash>` so `lastReviewCommit()` finds
     it. It needs a tree change to commit — add a small file (e.g.
     `REVIEW.md`-like marker is NOT required; any tracked file works) OR use
     `git commit --allow-empty -m "review(gtd): create review for <shortHash>"`.
     Prefer `--allow-empty` so the step stays a pure history marker and does not
     interfere with diff content. Document the choice in a comment.

## Constraints

- One git mutation per step (per AGENTS.md).
- Steps must be generic and parameterised by the scenario text — no hidden magic
  constants.
- Do not duplicate existing steps (`a commit … that adds …`, `a file … with:`,
  `… is modified to:`).

## Acceptance criteria

- [ ] `Given("a default branch {string}", ...)` exists and makes
      `resolveDefaultBranch` resolve that name.
- [ ] `Given("a prior review commit for {string}", ...)` creates a commit with
      the exact `review(gtd): create review for <hash>` subject.
- [ ] Existing step definitions and scenarios are unaffected (`npm run test:e2e`
      or the cucumber script still green for untouched features).
