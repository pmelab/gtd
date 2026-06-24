# Update e2e cucumber features for the machine-directed-action behavior

Bring the cucumber e2e suite in line with the FINAL behavior (Parts A + B). The
e2e suite (`npm run test:e2e`) is SEPARATE from the vitest gate and runs against
the built bundle, so it asserts post-loop observables: git log subjects +
the next leaf's prompt, NOT the retired no-agent prompt strings.

## Files (this task)

- `tests/integration/features/auto-advance.feature`
- `tests/integration/features/review.feature`
- `tests/integration/features/test-gate.feature`
- `tests/integration/features/execute-gate.feature`
- `tests/integration/features/spec-review-conclude.feature`
- (any other feature asserting cleanup/close-review/code-changes/test-gate
  prompt strings — grep first: `cleanup`, `Clean up after`, `Commit the
  uncommitted changes`, `close approved review`, `## Test gate (run first)`,
  `format REVIEW.md` under human-review test-gate)
- `tests/integration/support/steps/common.steps.ts` (add composable assertion
  steps if missing — see below)

> Depends on package 06 task 02 (bundle rebuild) being run before `npm run
> test:e2e` — coordinate so the bundle reflects the new code. The bundle rebuild
> is its own task in this package.

## Required changes (composable Given/Then per AGENTS.md)

Use the existing composable steps (`Given a file ... with:`, `Given a commit
... that adds ...`, `Then stdout contains ...`). For post-loop git observables,
add (if not present) thin `Then` steps backed by `world.ts`'s existing
`gitLog()` / `lastCommitSubject()` helpers, e.g.:

- `Then the last commit subject is {string}`
- `Then the git log contains {string}`

(`world.ts` already exposes `gitLog()`, `lastCommitSubject()`,
`lastCommitBody()` — wire `Then` steps to them in `common.steps.ts`.)

### `auto-advance.feature`

- "Code changes prompt includes auto-advance" — the `code-changes` leaf no longer
  emits a prompt; assert the commit landed (`Then the last commit subject is
  "chore(gtd): commit pending changes"`) AND the next leaf's prompt (the run
  drives the loop, so the FINAL stdout is the next state's prompt, e.g. verified
  / new-todo). Update accordingly.

### `review.feature` / `spec-review-conclude.feature`

- close-review assertions: assert the commit subject via the git-log step
  (`chore(gtd): close approved review for <short>`) + the next leaf's prompt,
  NOT the retired `close-review` prompt string.
- review-process: still produces the synthesis prompt (the agent work stays);
  keep asserting the synthesis prompt + the recorded/reverted commit subjects in
  the log.

### `test-gate.feature`

- Keep the execute-only gate scenarios (green→execute prompt, red<cap→fix-tests,
  red≥cap→escalate). REMOVE/repurpose the `human-review` test-gate scenarios:
  assert `human-review` reaches REVIEW.md generation WITHOUT running the suite
  (a red `package.json` test must NOT block human-review anymore). Add a
  scenario asserting human-review does not spawn the runner (e.g. a red test
  command still yields the REVIEW.md prompt).

### `execute-gate.feature`

- Update the green scenario: it currently asserts `remove the now-empty `.gtd/`
  directory` (injected by Prompt.ts). After Part B that instruction is removed
  (the edge handles cleanup) — drop that assertion. Keep the execute prompt +
  package-content assertions and the fix-tests / escalate scenarios.

### New scenarios (Part A loop coverage)

- cleanup: a stray empty `.gtd/` → the loop removes it (assert the dir is gone +
  the next leaf's prompt; no `cleanup` prompt string in stdout).
- code-changes: a dirty non-TODO file → commit landed + next prompt.
- no-agent hop cap / stuck: force a no-agent state to recur (e.g. a
  `commitPending` that leaves the tree dirty) and assert the escalate prompt.

### New scenarios (Part B coverage)

- execute: agent leaves package output uncommitted + intent marker → next run's
  edge commits with the `COMMIT_MSG.md` subject and removes the consumed
  `.gtd/NN-...`; assert via git-log step.
- decompose / human-review / new-todo / modified-todo / execute-simple /
  fix-tests: each leaves work uncommitted + marker → next run commits with the
  expected subject; assert via git-log step. fix-tests: assert the
  `Gtd-Test-Fix:` trailer is present (`lastCommitBody()`).

## Acceptance criteria

- [ ] No feature asserts a retired prompt string (`Clean up after`, `Commit the
      uncommitted changes`, `close approved review` as a PROMPT, `## Test gate
      (run first)` for planning/human-review).
- [ ] human-review e2e proves the suite is NOT run.
- [ ] Part A loop scenarios (cleanup/code-changes/hop-cap) added.
- [ ] Part B commit scenarios added, asserting subjects via git log + the
      `Gtd-Test-Fix:` trailer for fix-tests.
- [ ] `npm run test:e2e` passes against the rebuilt bundle (task 02 of this
      package).

## Constraints / edge cases

- e2e reflects FINAL behavior; it is NOT part of the vitest green-on-its-own gate
  (Rule 2) — but it MUST pass before the work is considered done.
- Keep `Given` steps generic and show the actual tree state in scenario text.
