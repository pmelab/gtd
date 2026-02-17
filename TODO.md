# Dedicated Commit Types for TODO Additions and Planning Feedback

## Action Items

### New Commit Prefixes

- [ ] Add `SEED` and `FEEDBACK` commit prefixes in `CommitPrefix.ts`
  - Add `export const SEED = "🌱" as const` for initial TODO file
    creation/additions
  - Add `export const FEEDBACK = "💬" as const` for planning feedback
    (blockquotes, review comments on existing plans)
  - Add both to the `CommitPrefix` union type and `ALL_PREFIXES` array
  - Tests: `parseCommitPrefix("🌱 create TODO")` returns `SEED`;
    `parseCommitPrefix("💬 add review notes")` returns `FEEDBACK`

### Classify Feedback Commits by Intent

- [ ] Split the `commit-feedback` command to distinguish initial TODO additions
      from planning feedback
  - In `commit-feedback.ts`, after classifying the diff, detect whether the TODO
    file is being created (new file in diff) vs. modified (existing plan file
    with added blockquotes/comments)
  - Use `🌱` (SEED) prefix when the TODO file diff shows a new file
    (`--- /dev/null`) or the file has no existing action items (state is `empty`
    or `notes`)
  - Use `💬` (FEEDBACK) prefix when the TODO file diff modifies an existing plan
    (state has action items, user added blockquotes or edits)
  - Keep `🤦` (HUMAN) for non-TODO code-only human changes that don't fit the
    above categories
  - Tests: mock a diff with `--- /dev/null` for TODO file → commit uses `🌱`;
    mock a diff modifying existing plan with blockquotes → commit uses `💬`;
    mock a diff with only code changes → commit uses `🤦`

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

## Open Questions

- Should `🤦` (HUMAN) be kept for mixed changes that include both code fixes and
  TODO edits, or should it be fully replaced by the new types?

## Learnings

- When adding new commit prefixes, update all three layers: `CommitPrefix.ts`
  (definition + parsing), `InferStep.ts` (next-step logic), and
  `DecisionTree.ts` (display labels)
