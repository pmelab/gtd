# Machine resolve: grilling idempotency + cap=0 resume (Group D, part 1)

Fix two machine-resolve bugs (#13, #15). Both touch `src/Machine.ts` (#13 also
touches `src/Git.ts`). They are file-disjoint from the TestRunner task
(`02-...`) in this package, so the two tasks run in parallel.

## Files (this task owns these — do NOT touch TestRunner.ts / the testing path)

- `src/Machine.ts` (resume branch ~403-406; grilling marker branch ~499-507)
- `src/Git.ts` (the `commitPending` edge / `~line 231` empty-commit creation)
- `tests/integration/features/grilling.feature` (idempotency scenario, #13)
- `tests/integration/features/fixing.feature` (cap=0 scenario, #15)
- `tests/integration/support/steps/*.ts` (add generic steps if needed — e.g. a
  commit-count assertion; check first)
- `README.md` (if documented behavior changes)

## Bugs to fix

### #13 — grilling STOP not idempotent (empty `gtd: grilling` commit per re-run)

- Location: `src/Machine.ts:499-507` (the `todoMarkerPresent` STOP branch) and
  the `commitPending` edge in `src/Git.ts` (~line 231) which creates a fresh
  commit.
- Today the marker STOP branch always returns
  `edgeAction: { kind: "commitPending", prefix: "gtd: grilling" }`. When the
  user has NOT yet answered (marker still present, tree clean, HEAD already
  `gtd: grilling`), re-running gtd creates another empty `gtd: grilling` commit
  every time.
- Guard: when waiting for the human answer — marker present **AND** working tree
  clean **AND** HEAD subject is already `gtd: grilling` — drop the `edgeAction`
  so the re-run is a pure no-op (still STOP, still emit the same prompt).
- Decide cleanly: only emit `commitPending` when there is actually something to
  commit (pending tree) or the HEAD is not yet `gtd: grilling`.
- The machine has `head` and `workingTreeClean` (`p.workingTreeClean`) available
  in this branch — use them; don't add new gathered inputs unless necessary.

### #15 — `cap=0` human-resume grants one unintended FEEDBACK attempt

- Location: `src/Machine.ts:403-406` (the testing-edge resume path).
- Currently
  `capReached: resume ? false : counters.testFixCount >= p.fixAttemptCap`. With
  `fixAttemptCap = 0`, a human resume (pending ERRORS.md deletion) hardcodes
  `capReached: false`, so it still grants one attempt even though the cap is 0.
- Compute `capReached` from the (reset-on-resume) count vs the cap, even on
  resume: `capReached: (resume ? 0 : counters.testFixCount) >= p.fixAttemptCap`.
- This depends on package `01-config-schema-loading` allowing `fixAttemptCap: 0`
  as a valid config value (it does). The machine itself is pure — exercise via a
  `.gtdrc` with `fixAttemptCap: 0`.

## Constraints / edge cases

- #13: a re-run at the grilling STOP must NOT add a commit, must still emit the
  grilling STOP prompt, and the HEAD/commit count must be unchanged. The FIRST
  run that has pending edits (or HEAD not yet `gtd: grilling`) must still commit
  as before — don't break the "open marker stops for the user" existing scenario
  (which seeds HEAD already at `gtd: grilling` + clean tree; verify that
  scenario still passes — after the fix it should be a no-op and still STOP).
- #15: with `fixAttemptCap >= 1`, resume still grants the expected attempt (the
  reset count `0 >= cap` is false for cap >= 1). Only `cap=0` changes behavior.
- Keep the change in the pure machine where possible; `Git.ts` only needs
  adjustment if the no-op must be enforced at the edge (prefer dropping the
  `edgeAction` in the machine so `Git.ts` is untouched — only edit `Git.ts` if a
  commit-with-no-changes still slips through).

## Cucumber scenarios

Per AGENTS.md: composable generic `Given` steps, real content in scenario text,
one commit per setup step.

### #13 → `grilling.feature`

- Re-run idempotency: seed HEAD `gtd: grilling` with a TODO.md that still has
  the `<!-- user answers here -->` marker and a clean tree. Run gtd twice.
  Assert the commit count (or HEAD sha) is unchanged after the second run, and
  the grilling STOP prompt is still emitted both times.
- This needs an assertion on commit count / HEAD stability. Reuse
  `Then the last commit subject is {string}` plus a new generic step like
  `Then the commit count is {int}` or
  `Then HEAD is unchanged since the previous run` — check
  `common.steps.ts`/`gtd-state.steps.ts` first; add a small generic step (e.g.
  counting `git rev-list --count HEAD`) if none exists.

### #15 → `fixing.feature`

- `fixAttemptCap: 0` resume: configure `.gtdrc` with `fixAttemptCap: 0`, set up
  the human-resume state (pending ERRORS.md deletion), run gtd, and assert it
  escalates (writes ERRORS.md / shows the Escalate task) instead of granting a
  FEEDBACK attempt. Mirror the existing `fixAttemptCap: 1` config scenario for
  setup shape.

## Acceptance criteria

- [ ] Re-running gtd at the grilling STOP (marker present, clean tree, HEAD
      already `gtd: grilling`) is a no-op: no new commit, same STOP prompt
- [ ] First grilling pass (pending edits or HEAD not yet `gtd: grilling`) still
      commits as before
- [ ] `fixAttemptCap: 0` resume does not grant a FEEDBACK attempt — it escalates
- [ ] `fixAttemptCap >= 1` resume still grants the expected attempt
- [ ] New scenarios in `grilling.feature` (idempotency, with a commit-count
      assertion) and `fixing.feature` (cap=0)
- [ ] Existing grilling / fixing / build-lifecycle scenarios still pass
- [ ] README updated if behavior is documented
- [ ] Full test suite is green
