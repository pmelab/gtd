# Fix commit ordering: fixes before feedback in commit-feedback

## Action Items

### Ensure code fixes are committed before plan-file feedback

The `commitFeedbackCommand` processes categories in order: SEED → HUMAN → FIX →
FEEDBACK. The last commit's prefix determines the next step via `inferStep`.
When the last prefix is FEEDBACK (💬), the next step is `plan`. When it's FIX
(👷), the next step is `build`. The user observed FIX committed after FEEDBACK,
causing `build` instead of `plan` — the plan step never processed the feedback.

- [ ] Add an integration test for mixed feedback + fixes commit ordering

  - Create a diff containing both plan-file edits (FEEDBACK) and code changes
    (FIX)
  - Assert commits are produced in order: FIX (👷) then FEEDBACK (💬)
  - Assert the last commit prefix is FEEDBACK so `inferStep` routes to `plan`
  - Tests: new test case in `commit-feedback.test.ts` with a diff combining
    `TODO.md` edits and source file changes; verify
    `commits[commits.length - 1].message` starts with `💬`

- [ ] Reorder categories in `commitFeedbackCommand` so FEEDBACK is always last

  - In `src/commands/commit-feedback.ts`, the `categories` array push order
    should be: SEED → HUMAN → FIX → FEEDBACK (current code already has this
    order — verify it matches runtime behavior)
  - If the ordering is already correct, investigate whether `stageByPatch` for
    FIX accidentally stages plan-file hunks, or whether the agent invocation for
    an earlier category modifies files that shift content into a later patch
  - Tests: run the new integration test and existing `commit-feedback.test.ts`
    tests

- [ ] Skip agent invocation for FIX-only categories
  - The `commitPrompt` agent invocation runs in mode `"plan"` for every
    category, including FIX — the agent might modify the plan file during a FIX
    commit, causing unexpected side effects
  - Only invoke the agent for categories that need plan-file processing (SEED,
    FEEDBACK, HUMAN); for FIX, skip the agent invocation and go straight to
    commit
  - Tests: mock agent in `commit-feedback.test.ts` and assert it is NOT called
    for the FIX category; assert it IS called for FEEDBACK/SEED/HUMAN categories

### Verify end-to-end step inference after mixed commits

- [ ] Add a test that chains `commitFeedbackCommand` → `gatherState` →
      `inferStep` with mixed feedback + fixes
  - After commit-feedback processes both FIX and FEEDBACK, `gatherState` should
    see the FEEDBACK prefix as the last commit
  - `inferStep` should return `"plan"` (not `"build"`)
  - Tests: in a new or existing test file, run `commitFeedbackCommand` with a
    mixed diff, then call `gatherState` and assert `inferStep(state) === "plan"`

## Learnings

- Always ensure the last commit in a multi-commit sequence carries the prefix
  that determines the correct next step — commit ordering is a control-flow
  concern, not just a cosmetic one
- Never invoke the planning agent for categories that don't need plan-file
  processing — agent side effects during FIX commits can corrupt the commit
  sequence
