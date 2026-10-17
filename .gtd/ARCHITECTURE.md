# Architecture

**Test-only change: the behaviour already ships.** `replayFinishedProcess`
(`src/edge/Edge.ts`) wraps the config-edited refusal with `withWarning`, which
appends the version warning on a new line of the same error message whenever the
closing commit's `Gtd-Version` differs from the running gtd. `gtd slices`
reaches it through `processSlices` → `replayedSlices`. Nothing in `src/`
changes.

## Interfaces

No interface change — the scenario exercises the shipped `gtd slices` command as
it stands.

## Call Stacks

- `gtd slices` → CLI slices command → `processSlices` → `runAtHead` (closing
  commit found) → `replayedSlices` → `replayFinishedProcess` →
  `versionWarningFor` (`0.0.1` ≠ version under test → warning) →
  `differingConfigPaths` (non-empty: `gtd.config.ts`) →
  `Effect.fail(withWarning(configRefusal(...)))` → CLI prints the one message to
  stderr, exit 1, stdout empty

## E2E Scenarios

- e2e: tests/integration/features/slices-command.feature — `@inmem` (the
  feature-level tag already covers it); a finished process whose closing commit
  was recorded by gtd 0.0.1, with `gtd.config.ts` rewritten afterwards by adding
  one comment line, makes `gtd slices` exit 1 with empty stdout; stderr contains
  `gtd slices: refused`, `revert or stash the edit`, `recorded by gtd 0.0.1`,
  and the gtd version under test — presence only, no line-order assertion
  (covers 1)

Scenario build notes:

- Copy the setup of "a finished process whose config was edited afterwards
  refuses, advising revert or stash", but replace its last
  `gtd lands "gtd(agent): checking → idle"` with
  `the working tree is committed with message:` carrying
  `gtd(agent): checking → idle`, a blank line, `Gtd-Step: checking#1`,
  `Gtd-Version: 0.0.1`, `Gtd-Format: 1` — exactly as "a closing commit recorded
  by another gtd version warns on stderr, stdout unchanged" does
- Then `a file "gtd.config.ts" with:` the same flow plus one comment line; leave
  it uncommitted, as the copied scenario does
- Steps used, all existing: `the exit code is 1`, `stdout is empty`,
  `stderr contains "…"`, `stderr contains the gtd version under test`
- **No `gtd history show` scenario** — out of scope per concern 1

## Unit Tests

No interface entry, so no unit test — the requirement is a scenario-level pin of
CLI output (stdout/stderr/exit code), which only the e2e tier observes.

## Answered Questions

### Does `gtd history show` also need a pinning scenario this round?

No — the review note names `gtd slices` alone; adding more widens a "could" fix
beyond what was asked.

### Should the scenario mark commits or assert slice hashes?

No — a refusal prints nothing to stdout, so `I mark the current commit as` steps
add noise without an assertion to feed.

### Should the config edit be committed before running `gtd slices`?

No — the copied refusal scenario leaves it uncommitted and the edit check reads
the working tree; committing would add a non-gtd commit and switch to the
different "non-gtd commit after a finished process" refusal.
