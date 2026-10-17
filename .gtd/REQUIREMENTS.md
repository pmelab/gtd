# Requirements

One review note survives triage (note-1, the `runSummaryCommand` doc comment, is
deferred to `.gtd/TODO.md`). Scope: the version warning now rides on refusals
from `gtd slices` and `gtd history show`, not just `gtd summary --slice`, and
nothing pins that for `gtd slices`.

**Baseline is green**: `npm test` passed on this lap before any change.

## 1. Pin the version warning on a `gtd slices` refusal (TECHNICAL)

(critical: judge unsure) — from note-2, anchored at the `src/` hunk that appends
the version warning to refusals ("have no test pinning the appended warning").

- **Add exactly one `@inmem` scenario to
  `tests/integration/features/slices-command.feature`** where `gtd slices`
  refuses because **the config was edited after a closing commit recorded by gtd
  0.0.1**
- Setup: copy the "a finished process whose config was edited afterwards
  refuses" scenario's shape, but land the closing commit with
  `the working tree is committed with message:` carrying `Gtd-Step: checking#1`,
  `Gtd-Version: 0.0.1`, `Gtd-Format: 1` (as the "a closing commit recorded by
  another gtd version warns" scenario does), then rewrite `gtd.config.ts` with
  an added comment line
- **Assert all four**: exit code 1; stdout empty; stderr contains the refusal
  (`gtd slices: refused` and `revert or stash the edit`); stderr contains the
  warning (`recorded by gtd 0.0.1` and the gtd version under test)
- **Assert presence, not line order** — the refusal and warning share one error
  message today; pinning order couples the test to that join
- Use only existing composable Given/Then steps; no new one-off step
- **Out of scope: a `gtd history show` refusal scenario** — the human asked for
  `gtd slices` only; do not add one

## Answered Questions

### Does `gtd history show` also need a pinning scenario this round?

No — the review note names `gtd slices` alone; adding more widens a "could" fix
beyond what was asked.
