# Requirements

One review note survives triage (note-1, the `runSummaryCommand` doc comment, is
deferred to `.gtd/TODO.md`). Scope: the version warning now rides on refusals
from `gtd slices` and `gtd history show`, not just `gtd summary --slice`, and
nothing pins that for `gtd slices`.

## 1. Pin the version warning on a `gtd slices` refusal (TECHNICAL)

(critical: judge unsure) — from note-2, anchored at the `src/` hunk that appends
the version warning to refusals ("have no test pinning the appended warning").

- **Add exactly one `@inmem` scenario to
  `tests/integration/features/slices-command.feature`** where `gtd slices`
  refuses because **the config was edited after a closing commit recorded by gtd
  0.0.1**
- Setup: the existing "config was edited afterwards" scenario's shape, but the
  closing commit is landed with an explicit message carrying
  `Gtd-Version: 0.0.1` (as the existing "recorded by gtd 0.0.1" scenario does),
  then `gtd.config.ts` is rewritten
- **Assert stderr carries both lines**: the refusal (`gtd slices: refused` /
  `revert or stash the edit`) **and** the warning (`recorded by gtd 0.0.1` plus
  the gtd version under test); exit code 1, stdout empty
- Use only existing composable Given steps; no new one-off step
