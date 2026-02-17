# Dedicated Commit Types for TODO Additions and Planning Feedback

## Action Items

### New Commit Prefixes

- [x] Add `SEED` and `FEEDBACK` commit prefixes in `CommitPrefix.ts`
  - Add `export const SEED = "🌱" as const` for initial TODO file
    creation/additions
  - Add `export const FEEDBACK = "💬" as const` for planning feedback
    (blockquotes, review comments on existing plans)
  - Add both to the `CommitPrefix` union type and `ALL_PREFIXES` array
  - Tests: `parseCommitPrefix("🌱 create TODO")` returns `SEED`;
    `parseCommitPrefix("💬 add review notes")` returns `FEEDBACK`

### Classify Feedback Commits by Intent

- [ ] Refine `commit-feedback.ts` to use four distinct commit prefixes based on
      change type

  - Split the current two-way classification (fixes vs feedback) into a
    three-way classification: seed, feedback, and human-code-todos
  - Use `🌱` (SEED) when the TODO file diff shows a new file (`--- /dev/null`)
    or the file has no existing action items (state is `empty` or `notes`)
  - Use `💬` (FEEDBACK) when the TODO file diff adds blockquote lines (`> ...`)
    to an existing plan — these are review comments / planning feedback
  - Use `🤦` (HUMAN) only for hunks in non-TODO code files that contain
    TODO/FIXME markers — these are inline code annotations, not planning
    feedback
  - Use `👷` (FIX) for actual code changes (already handled by `fixes` path)
  - Tests: mock a diff with `--- /dev/null` for TODO file → commit uses `🌱`;
    mock a diff adding blockquotes to existing plan → commit uses `💬`; mock a
    diff with TODO markers in code files only → commit uses `🤦`; mock a diff
    with only code changes → commit uses `👷`

- [ ] Update `DiffClassifier.ts` to distinguish seed vs feedback vs
      human-code-todo hunks
  - Add a `seed` category for new-file TODO diffs (`--- /dev/null`)
  - Add a `feedback` category for blockquote additions in the TODO file (lines
    matching `+> ` or `+  > `)
  - Keep `isTodoFeedbackHunk` for remaining TODO file changes that aren't
    blockquotes (these still go to feedback but get `🌱` if file is new)
  - Keep `isFeedbackHunk` for code-file TODO markers → these get `🤦` (HUMAN)
  - Return a three-part result: `{ fixes, seed, feedback, humanTodos }` instead
    of the current `{ fixes, feedback }`
  - Tests: `classifyDiff` with new TODO file → populates `seed`; `classifyDiff`
    with blockquote additions → populates `feedback`; `classifyDiff` with code
    TODO markers → populates `humanTodos`

### Update Decision Tree for New Prefixes

- [ ] Handle `SEED` and `FEEDBACK` in `InferStep.ts`

  - `SEED` → next step should be `"plan"` (user seeded a TODO, agent should plan
    from it)
  - `FEEDBACK` → next step should be `"plan"` (user gave feedback, agent should
    re-plan)
  - Tests: `inferStep({ lastCommitPrefix: SEED, ... })` returns `"plan"`;
    `inferStep({ lastCommitPrefix: FEEDBACK, ... })` returns `"plan"`

- [ ] Update `DecisionTree.ts` with labels for new prefixes
  - Add `case SEED: return "🌱 seed"` and `case FEEDBACK: return "💬 feedback"`
    to `prefixLabel`
  - Tests: `formatDecisionTrace` with `lastCommitPrefix: SEED` includes
    `"🌱 seed"` in output

### Update CLI State Gathering

- [ ] Ensure `gatherState` in `cli.ts` handles the new prefixes correctly
  - `SEED` and `FEEDBACK` should be treated like `HUMAN` for
    `onlyLearningsModified` detection (check committed diff)
  - `todoFileIsNew` detection remains unchanged — it's used by `BUILD`/`FIX`
    transitions, not by `SEED`/`FEEDBACK`
  - Tests: `gatherState` after a `🌱` commit correctly infers `plan` as next
    step; after a `💬` commit correctly infers `plan`

### Bats Integration Tests

- [ ] Add bats e2e tests for `🌱` (SEED) and `💬` (FEEDBACK) commit workflows in
      `tests/integration/gtd-workflow.bats`
  - Add a test that creates a new TODO.md, runs `gtd commit-feedback`, and
    asserts the commit prefix is `🌱`
  - Add a test that adds blockquote feedback (`> ...`) to an existing plan, runs
    `gtd commit-feedback`, and asserts the commit prefix is `💬`
  - Add a test that adds TODO markers in a code file, runs
    `gtd commit-feedback`, and asserts the commit prefix is `🤦`
  - Add a test that verifies `gtd` after a `🌱` commit triggers a plan step
    (next commit is `🤖`)
  - Add a test that verifies `gtd` after a `💬` commit triggers a re-plan step
    (next commit is `🤖`)
  - Tests: run `./tests/integration/gtd-workflow.bats` — all new cases pass

## Open Questions

- Should `🤦` (HUMAN) be removed entirely once `🌱`, `💬`, and `👷` cover all
  cases, or kept as a fallback for ambiguous mixed diffs?

## Learnings

- When adding new commit prefixes, update all three layers: `CommitPrefix.ts`
  (definition + parsing), `InferStep.ts` (next-step logic), and
  `DecisionTree.ts` (display labels)
- Commit prefix semantics follow change intent: `🌱` for seeding plans, `💬` for
  planning feedback (blockquotes), `🤦` for inline code TODOs, `👷` for actual
  code fixes — keep these orthogonal to avoid ambiguous classification
