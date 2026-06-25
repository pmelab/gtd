# Cucumber scenarios: gtd-workflow commits above a closed review don't re-open it

## Description

Add integration coverage proving the frontier survives gtd-workflow commits
landing on top of a closed review, and still re-opens for real code. Follow
`AGENTS.md`: small composable, generic `Given` steps that expose the actual
commits in scenario text (one commit per step). Reuse existing steps where
possible.

## Files

- New feature file: `tests/integration/features/review-frontier.feature`
- Step definitions: `tests/integration/support/steps/common.steps.ts` (add only
  the ONE missing step below; reuse everything else).

## Reusable existing steps (do NOT redefine)

- `Given a test project`
- `Given a commit {string} that adds {string} with:`
- `Given a prior review commit for {string}` (empty `review(gtd): create review
  for <sha>` marker)
- `Given a file {string} with:` (untracked dirty file)
- `When I run gtd`
- `Then it succeeds`
- `Then stdout contains {string}` / `Then stdout does not contain {string}`
- `Then the file {string} exists` / `Then the file {string} does not exist`

## One new step to add (`common.steps.ts`)

A close-commit marker mirroring `a prior review commit for {string}`:

```
Given("a prior close commit for {string}", function (this: GtdWorld, shortHash: string) {
  execFileSync(
    "git",
    ["commit", "--allow-empty", "-m", `chore(gtd): close approved review for ${shortHash}`],
    { cwd: this.repoDir, stdio: "pipe" },
  )
})
```

(If a `plan(gtd): grilling` commit step is needed, the existing
`a plain fix\(gtd) feature commit {string}` only handles fix; instead add the
plan commit inline using `a commit {string} that adds {string} with:` with a
real-ish TODO.md, OR add a small generic empty-commit step. Prefer reusing
`a commit ... that adds ...` so the commit subject is visible in scenario text.)

## Scenarios

Mirror the assertion style of the existing `review.feature` "After closing, the
next run reports verified" scenario (which asserts
`stdout contains "working tree healthy and fully reviewed"` and
`stdout does not contain "Generate REVIEW.md after successful verification"`).
Confirm those exact strings against the current prompt output before finalizing;
adjust to whatever the verified/idle and human-review prompts actually print.

1. **Regression — plan commit on top of a close does not re-open review.**
   Given a test project; And a commit `feat(gtd): add foo helper` that adds
   `src/foo.ts`; And a prior close commit for `abc1234`; And a commit
   `plan(gtd): grilling` that adds `TODO.md` with a short plan body.
   When I run gtd. Then it succeeds; And stdout contains the verified/healthy
   string; And stdout does not contain the REVIEW.md-generation string; And the
   file `REVIEW.md` does not exist.

2. **Still reviews real code on top of a close.**
   Given a test project; And a prior close commit for `abc1234`; And a commit
   `feat: real change` that adds `src/real.ts` with real source.
   When I run gtd. Then it succeeds; And stdout contains the human-review /
   "Generate REVIEW.md" string (whatever the human-review prompt prints).

3. **Mixed — plan commit then real code on top of a close still re-opens.**
   Given a test project; And a prior close commit for `abc1234`; And a commit
   `plan(gtd): grilling` that adds `TODO.md`; And a commit `feat: real change`
   that adds `src/real.ts` with real source.
   When I run gtd. Then it succeeds; And stdout contains the human-review
   string (the real code re-opens review even though a plan commit is in range).

## Acceptance criteria

- [ ] New file `tests/integration/features/review-frontier.feature` with the
      three scenarios above, commits visible in scenario text.
- [ ] Exactly one new step (`a prior close commit for {string}`) added to
      `common.steps.ts`; all other steps reused.
- [ ] Scenario 1 asserts no `REVIEW.md` and the verified/healthy output.
- [ ] Scenarios 2 and 3 assert the run enters human-review.
- [ ] `npm run test:e2e` passes.

## Constraints

- Do not modify `src/` here (the fix lives in task 01).
- Generic, composable Given steps only — no scenario-specific setup steps.
- One commit per Given step.
