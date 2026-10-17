# 01 — pin version warning on `gtd slices` config-edited refusal

## Requirement

**Concern 1: `gtd slices` refusing an edited config must also carry the version
warning when the closing commit came from another gtd version.** The behaviour
already ships; this slice pins it with one e2e scenario. **Nothing in `src/`
changes.** No `gtd history show` scenario — out of scope.

## Tasks

### Task 1: add the scenario

Add a scenario to `tests/integration/features/slices-command.feature`, beside "a
finished process whose config was edited afterwards refuses, advising revert or
stash" (line ~185).

- [ ] Setup copies that scenario, except its final
      `gtd lands "gtd(agent): checking → idle"` becomes
      `the working tree is committed with message:` carrying
      `gtd(agent): checking → idle`, a blank line, `Gtd-Step: checking#1`,
      `Gtd-Version: 0.0.1`, `Gtd-Format: 1` — as in "a closing commit recorded
      by another gtd version warns on stderr, stdout unchanged" (line ~90)
- [ ] Then `a file "gtd.config.ts" with:` the same flow plus one comment line,
      **left uncommitted** — committing switches to the non-gtd-commit refusal
- [ ] Asserts, existing steps only: `the exit code is 1`, `stdout is empty`,
      `stderr contains "gtd slices: refused"`,
      `stderr contains "revert or stash the edit"`,
      `stderr contains "recorded by gtd 0.0.1"`,
      `stderr contains the gtd version under test`
- [ ] **Presence only — no line-order assertion**; no
      `I mark the current     commit as` steps
- [ ] No new tag — the feature-level `@inmem` covers it
- [ ] Scenario passes; full suite (`npm test`) green

Paths: `tests/integration/features/slices-command.feature`

## Tests

- e2e: `tests/integration/features/slices-command.feature`
