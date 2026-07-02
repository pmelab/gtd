# Tests: update the happy-path journey tail for Squashing

The happy-path journey in `journeys.feature` currently ends `gtd: done` → Idle
with an exact commit-subject-sequence assertion that ends at `gtd: done`. With
squash enabled by default, after `gtd: done` lands the machine auto-advances to
**Squashing** and emits the Squashing prompt (NOT the Idle prompt). This task
updates that scenario's tail so the suite stays green.

## Files

- `tests/integration/features/journeys.feature` (edit)

Do NOT create `squashing.feature` (task 03) or touch docs. Reuse existing steps
only.

## Context (current happy-path tail — the "Scenario: Happy path" block)

Today, Run 10 asserts:

```
And the last commit subject is "gtd: done"
And stdout contains "## Task: Nothing to do"     <-- WILL BREAK: now Squashing
```

and Run 11 asserts Idle stability + the exact commit-subject sequence ending at
`gtd: done`.

With `squash: true` (the default; this scenario's `.gtdrc` sets only
`testCommand: "true"`, so squash defaults on), the run that lands `gtd: done`
now resolves **Squashing** and prints the Squashing prompt, not Idle.

## What to change

Update the tail of the **Happy path** scenario to reflect the squash hop:

1. **Run 10** (the human approves → `gtd: done`): after asserting the last
   commit subject is `gtd: done`, the same `gtd` invocation auto-advances to
   Squashing and STOPS printing the Squashing prompt. Change the stdout
   assertion from `## Task: Nothing to do` to the Squashing section heading /
   key text (match `src/prompts/squashing.md`), and assert stdout contains
   `git reset --soft`. (`gtd: done` is still the last commit — the agent has not
   squashed yet; the squash is external.)

2. **Simulate the agent squashing** — add `When` steps that perform the squash
   the prompt asked for, using existing steps. The squash is
   `git reset --soft <base>` + `git commit`. There is no single composable step
   for a soft-reset+commit; the simplest fixture that produces the post-squash
   state is to model the end state the machine must settle from. Options, pick
   the one that fits the available steps without inventing new ones:
   - If a suitable step exists to reset+commit, use it.
   - Otherwise, assert the Squashing prompt (step 1) and END the scenario there,
     OR split: keep the exact-sequence assertion but update it so its final
     entries reflect the pre-squash state (ending `gtd: done`) and drop the "Run
     11 Idle stable" tail that assumed Idle immediately after `gtd: done`.

   IMPORTANT: the exact-commit-subject-sequence docstring currently ends at
   `gtd: done` and is asserted while the tree is still at `gtd: done`
   (pre-squash, since the agent squash is external and not performed by `gtd`).
   If the scenario asserts the sequence BEFORE any external squash step, the
   existing docstring stays valid — only the Run 10/11 _prompt_ assertions
   change (Idle → Squashing). Prefer this minimal change: keep the
   commit-subject sequence as-is (it ends `gtd: done`, which is still true), and
   only swap the Idle-prompt assertions for Squashing-prompt assertions + a
   `git reset --soft` check, then drop or adjust the "Idle is stable" Run 11
   (since a second `gtd` run on a `gtd: done` HEAD now re-emits the Squashing
   prompt, not Idle — it is idempotent at the prompt level, no new commit).

3. Audit the other journey scenarios (verified — these outcomes are NOT
   speculative):
   - **Feedback journey** — its history DOES contain `gtd: grilling` commits
     (the initial `gtd: grilling` at the top, plus the feedback-rebuild
     grilling), and it ends at `gtd: done` with `## Task: Nothing to do`
     (currently line ~240). With squash on by default, `squashGrilling` resolves
     and `squashBase` is set, so this `gtd: done` run routes to **Squashing**.
     This assertion WILL BREAK — update it exactly like the happy path (swap
     `## Task: Nothing to do` for the Squashing section text + a
     `git reset --soft` assertion). The commit-subject history ending
     `gtd: done` stays accurate (gtd does not perform the squash).

   - **Multi-review branch** — its history has NO `gtd: grilling` commit
     anywhere (`feat: first slice` → `gtd: awaiting review` → `gtd: done`,
     twice). So `squashGrilling` is `undefined`, `squashBase` stays unset, and
     both `gtd: done` runs stay **Idle** (`## Task: Nothing to do`). Leave this
     scenario UNCHANGED.

## Guidance for choosing the minimal fix

The cleanest approach: because `gtd` does NOT perform the squash (the agent
does), a single `gtd` run on a `gtd: done` HEAD with a squash base prints the
Squashing prompt and stops WITHOUT changing history. So:

- The commit-subject-sequence docstring (ending `gtd: done`) remains accurate.
- Swap Idle-prompt assertions for Squashing-prompt assertions wherever a
  `gtd: done` HEAD has an in-cycle `gtd: grilling` (happy path; and feedback
  journey if applicable).
- Leave scenarios whose `gtd: done` HEAD has NO in-cycle `gtd: grilling`
  (multi-review branch) as Idle.

## Acceptance criteria

- [ ] The Happy path scenario's post-`gtd: done` assertions expect the Squashing
      prompt (section text + `git reset --soft`), not `## Task: Nothing to do`.
- [ ] The commit-subject-sequence assertion still matches the actual landed
      history (unchanged if the external squash is not simulated).
- [ ] The Feedback journey's post-`gtd: done` assertion is switched to the
      Squashing prompt (it has grilling commits → squash fires); the
      Multi-review branch scenario is left as Idle (no grilling → no squash
      base).
- [ ] `npm run test:e2e` passes — the full journeys.feature is green. NOTE:
      integration tests run the BUILT bundle (`scripts/gtd.bundle.mjs`), and
      `pretest:e2e` rebuilds automatically; if running cucumber directly, run
      `npm run build` first so the squash code is in the bundle.
