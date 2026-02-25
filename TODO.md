# Remove Learnings Functionality

## Action Items

### InferStep: Remove `learn` step and `onlyLearningsModified`

- [x] Remove `"learn"` from the `Step` union type in `InferStep.ts`
  - Delete `| "learn"` from the `Step` type
  - Remove `readonly onlyLearningsModified: boolean` from `InferStepInput`
  - In `inferStep`, replace `"learn"` returns with `"cleanup"` for BUILD/FIX
    all-checked and HUMAN/FEEDBACK only-learnings-modified branches; for the
    LEARN prefix branch specifically, return `"idle"` (recognized but ignored —
    no-op to preserve backward compatibility with existing 🎓 commits)
  - Remove all `onlyLearningsModified` branches from the switch
  - Tests: run `npx vitest run src/services/InferStep.test.ts` — all tests pass;
    update tests that expected `"learn"` to expect `"cleanup"` instead, update
    the LEARN-prefix test to expect `"idle"`, remove tests for
    `onlyLearningsModified`

### LearningsDiff Service: Delete entirely

- [x] Delete `src/services/LearningsDiff.ts` and
      `src/services/LearningsDiff.test.ts`
  - Remove both files
  - Tests: confirm no remaining imports of `LearningsDiff` via
    `grep -r "LearningsDiff" src/`

### Markdown Utilities: Remove learnings helpers

- [x] Remove `extractLearnings` and `hasLearningsSection` from
      `src/services/Markdown.ts`
  - Delete the two exported functions
  - Remove their test cases from `src/services/Markdown.test.ts`
  - Tests: run `npx vitest run src/services/Markdown.test.ts` — all remaining
    tests pass

### CLI: Remove `learnAction` and `onlyLearningsModified` from `gatherState`

- [x] Remove `learnAction` function from `src/cli.ts`
  - Delete the entire `learnAction` function and the `LearnInput` interface
  - Remove imports of `isOnlyLearningsModified`, `extractLearnings`,
    `hasLearningsSection`, `learnPrompt`
  - In `gatherState`, remove the `onlyLearningsModified` computation block and
    the field from the returned object
  - Remove `onlyLearningsModified` from `prevPhasePrefix` logic if present
  - In `runStep`, remove the `"learn"` case
  - In `rootCommand` dispatch logic, remove the `onlyLearningsModified` merging
    in the `commit-feedback` branch
  - Tests: run `npx vitest run src/cli.test.ts` — all tests pass; update/remove
    tests that exercised `learnAction` or `onlyLearningsModified`

### CommitPrefix: Keep `LEARN` recognized but inert

- [x] Keep `LEARN` in `src/services/CommitPrefix.ts` but remove it from active
      routing logic
  - Retain `export const LEARN = "🎓" as const`, `typeof LEARN` in the union
    type, and `LEARN` in `ALL_PREFIXES` — existing repos with 🎓 commits must
    not break
  - Remove `LEARN` from `DecisionTree.ts` imports and `prefixLabel` /
    `describeReason` switches (treat it like any unrouted prefix)
  - In `InferStep.ts`, the LEARN prefix branch returns `"idle"` (handled in the
    InferStep task above)
  - Tests: run `npx vitest run src/services/CommitPrefix.test.ts` — all tests
    pass; confirm LEARN is still exported but no learn-step routing occurs

### Config & Schema: Remove `modelLearn`

- [x] Remove `modelLearn` from `src/services/Config.ts` and
      `src/services/ConfigSchema.ts`
  - Delete `readonly modelLearn: string | undefined` from the `GtdConfig`
    interface
  - Delete `modelLearn: Schema.optional(Schema.String)` from the schema
  - Remove `modelLearn` from `resolveModelForStep` in `DecisionTree.ts` (the
    `"learn"` case)
  - Tests: run
    `npx vitest run src/services/Config.test.ts src/services/ConfigSchema.test.ts`
    — all tests pass

### Prompts: Delete `learn.md` and remove export

- [x] Delete `src/prompts/learn.md` and remove `learnPrompt` from
      `src/prompts/index.ts`
  - Delete the file `src/prompts/learn.md`
  - Remove the `learnPrompt` export from `src/prompts/index.ts` and its test in
    `src/prompts/index.test.ts`
  - Tests: run `npx vitest run src/prompts/index.test.ts` — all remaining tests
    pass

### DecisionTree: Remove `learn` references

- [x] Remove all `learn`-related cases from `src/services/DecisionTree.ts`
  - Remove `"learn"` case from `resolveModelForStep`
  - Remove LEARN from `prefixLabel` and `describeReason` switches
  - Tests: run `npx vitest run src/decision-tree.test.ts` — all tests pass;
    update/remove tests that reference the learn step or LEARN prefix

### Integration Tests: Remove learnings scenarios

- [x] Remove learn-related scenarios and step definitions from integration tests
  - In `tests/integration/features/workflow.feature`, remove the
    `Scenario: Learn and cleanup` scenario and any step that uses
    `"learnings section"` or `"learning is removed"`
  - Remove `onlyLearningsModified`-related step definitions from
    `tests/integration/support/steps/workflow.steps.ts`
  - The `## Learnings` section in `TODO.md` files is ignored completely — no
    linting or validation step needed
  - Tests: run the integration test suite to confirm all remaining scenarios
    pass

## Learnings

- When removing a step from a linear workflow (plan → build → learn → cleanup),
  always trace every reference: Step type, inferStep logic, gatherState inputs,
  CLI runStep dispatch, commit prefix, config schema, prompts, decision tree
  labels, and all test files.
- When a commit prefix maps to a removed step, keep it recognized in the type
  system (for backward compatibility) but route it to `"idle"` — removing it
  entirely risks breaking existing repos that have those commits in history.
