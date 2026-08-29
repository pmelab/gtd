Task 8 — "Re-record the whole baseline in one run" — is the only unmet task.
Tasks 1–7 are done: 18 `tests:` entries across 9 cases, 9 `llm-rubric` blocks
(every `violation`, no `clean`), one `providers:` entry, `cellKey` rekeyed to
`label|case|variant`, `run-turn.mjs` case-agnostic, `asserts/shared.mjs`
extracted, `architecture-decompose.md` stated and inert.
`npx vitest run tests/tooling` is green (28 tests).

## `evals/baseline.json` is still the pre-rekey two-cell file

It holds exactly the two cells the rekey was supposed to retire:

```
"gemini-3.5|clean":     { "passed": 4, "total": 4 }
"gemini-3.5|violation": { "passed": 4, "total": 4 }
```

`recordedAt` is `2026-08-29T11:22:35.457Z` — a run of the old single-case
config, before any case file existed. Four of task 8's boxes are directly false:
2 cells not 18; no key shaped `gemini-3.5|<case>|<variant>`; both bare keys
remain; `recordedAt` predates the config it must describe.

Consequence is the four-way failure the spec's own risk note predicted, now at
nine cases: `report.mjs` emits `gemini-3.5|<case>|<variant>`, so
`compare-baseline.mjs` reports **18 "not recorded in baseline" violations plus 2
"missing from run" violations — 20 at once**, and `npm run eval` exits non-zero
on every run regardless of trial results. The rekey landed without the record
that has to ship with it.

Fix: run `npm run eval` once against the wired config, then
`npm run eval:baseline` (`node evals/compare-baseline.mjs --record`), and commit
the rewritten `evals/baseline.json`. Constraints that must not be traded away:

- **One record for the whole package**, never one per case — 9 cases × 2
  variants × `--repeat 4` = 72 turns in a single run.
- **`--max-concurrency` stays 2** (`evals/eval.mjs`). Raising it trades run time
  for gateway rate-limit failures that get written down as prompt regressions.
- **A suspiciously low cell is a flake to re-run, not a number to record** —
  `compare-baseline.mjs` only fails on a rate that DROPS, so a cell recorded
  below its true rate is a permanently lowered floor.
- Do not hand-edit the JSON; the file must come out of `--record`.
- `gemini-3.5-flash-lite` is measured in the coder half for the first time here
  (`packages-item-building`, `packages-item-fix-suite`,
  `packages-item-fix-spec`, `build-fix`). Mixed coder cells make it a candidate
  to replace, not a floor to record.

This task needs `GTD_EVALS_URL` and `GTD_EVALS_KEY` and an hours-long paid run.
If they are not available to the fix turn, say so plainly rather than
hand-writing cells — a fabricated baseline is worse than a missing one.

## Do not revert: the removed `validate` guard

`run-turn.mjs` no longer asserts an empty `validate` step. That is correct and
must stay deleted, even though task 4's box "Every trial still reports an empty
`validate` step" reads otherwise — the spec's premise is factually wrong. A
`mode: qa` / `mode: review` state resolves a built-in validator with no `modes:`
config present, so `design-triage`, `architecture-author`,
`build-review-reviewing` and `build-review-collecting` all return a NON-EMPTY
`gtd next --json=validate`. Restoring the guard fails 8 of 18 trials at startup.

## Already fixed — do not re-do

`packages-item-building`'s two variants no longer grade identically: its
`violation` entry carries a tier-3 rubric and
`asserts/packages-item-building.mjs` adds `checkNoOverreach`, which fails a
`src/formatName.ts` that exports `formatNames`. Settled; leave it alone.
