# Add cucumber tests for auto-advance behavior

Create integration tests verifying that auto-advance text appears in the correct prompts and STOP markers appear in terminal prompts.

## What to build

Create `tests/integration/features/auto-advance.feature` with scenarios that verify:

1. Prompts that should auto-advance contain the re-run instruction text
2. `verify` prompt contains STOP instruction in success path
3. `review-create` prompt contains STOP instruction

## Acceptance criteria

- [ ] File `tests/integration/features/auto-advance.feature` exists
- [ ] Scenario: prompts that auto-advance contain re-run text (test at least 2-3 representative branches like `new-todo`, `decompose`, `code-changes`)
- [ ] Scenario: verify prompt contains STOP/do-not-re-run text
- [ ] Scenario: review-create prompt contains STOP/do-not-re-run text
- [ ] All scenarios use composable Given steps (matching existing patterns in `branches.feature`)
- [ ] Tests pass when run with the project's test runner

## Relevant files

- `tests/integration/features/branches.feature` — reference for step patterns and style
- `tests/integration/steps/` — existing step definitions
- `src/Prompt.ts` — the code being tested (prompt assembly)

## Constraints

- Use existing Given/When/Then step definitions where possible
- Use `stdout contains` / `stdout does not contain` assertions (matching existing pattern)
- Each scenario should set up minimal git state to trigger the target branch
- Don't test ALL 8 auto-advance prompts — pick 2-3 representative ones to avoid brittle/verbose tests
