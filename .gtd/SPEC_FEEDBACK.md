Task 8 — "Re-record the whole baseline in one run" — is not done. Tasks 1–7
check out: all 18 fixtures build, rest at `kind=prompt`, and their
`expect[variant].gtdFiles` match what the workflow's own prompts and land
scripts actually change (verified by driving each fixture through `gtd --entry`
→ simulated turn → `gtd land`). `npm run format:check` and
`npx vitest run tests/tooling` are green.

## `evals/baseline.json` is still the pre-rekey two-cell file

It holds exactly the two cells this package's rekey was supposed to retire:

```
"gemini-3.5|clean":     { "passed": 4, "total": 4 }
"gemini-3.5|violation": { "passed": 4, "total": 4 }
```

`recordedAt` is `2026-08-29T11:22:35.457Z` — before the case files were written.
Four of the task's eight acceptance boxes are directly false: it carries 2
cells, not 18; no key is shaped `gemini-3.5|<case>|<variant>`; both old
`gemini-3.5|clean` / `gemini-3.5|violation` keys remain; `recordedAt`
corresponds to a run of the old, single-case config.

The consequence is the exact four-way failure the spec's own risk note called
out, now at nine cases instead of one: `evals/report.mjs`'s `cellKey` emits
`gemini-3.5|<case>|<variant>`, so `compareCells` reports **18 "not recorded in
baseline" violations plus 2 "missing from run" violations — 20 at once**, and
`npm run eval` exits non-zero on any run, green trials or not. The rekey landed
without the record that has to ship with it.

Fix: run `npm run eval` once against the wired config, then
`npm run eval:baseline` (`node evals/compare-baseline.mjs --record`), and commit
the rewritten `evals/baseline.json`. Constraints that still hold and must not be
traded away:

- **One record for the whole package**, never one per case — 9 cases × 2
  variants × `--repeat 4` = 72 turns in a single run.
- **`--max-concurrency` stays 2** (`evals/eval.mjs`). Raising it trades run time
  for gateway rate-limit failures that get written down as prompt regressions.
- **A suspiciously low cell is a flake to re-run, not a number to record** —
  `evals/compare-baseline.mjs` only fails on a rate that DROPS, so a cell
  recorded below its true rate is a permanently lowered floor.
- Do not hand-edit the JSON; the file must come out of `--record`.
- `gemini-3.5-flash-lite` is measured in the coder half for the first time here
  (`packages-item-building`, `packages-item-fix-suite`,
  `packages-item-fix-spec`, `build-fix`). If its coder cells come back mixed, it
  is a candidate to replace, not a floor to record.

## Secondary: `packages-item-building`'s two variants grade identically

`evals/cases/packages-item-building.mjs` sets both variants to `gtdFiles: []`,
`otherFiles: "required"`, declares no `plantedIdentifier` and no `outOfBounds`,
and `evals/promptfooconfig.yaml` gives neither variant a tier-3 rubric. Every
check the `violation` variant runs is a check the `clean` variant also runs with
the same expected values, so the pair measures one thing twice.

Concrete failure: a turn that implements `formatName` AND the tempting
`formatNames` from `.gtd/packages/02-format-names-batch.md` — the exact
over-reach the `violation` fixture plants — touches only `src/formatName.ts`, so
`gtdFiles` is `[]`, `otherFilesChanged` is non-empty, and the trial passes. Only
editing the planted package file itself is caught, and an agent has little
reason to do that. Task 5's box "Each grader fails a turn that touches that
out-of-bounds file" is technically satisfied via the `gtdFiles` check; task 7's
"Every `violation` entry carries the tier-3 `llm-rubric`" is not.

Either give the case a check that can distinguish its two sides (a
state-specific grader assertion in `evals/asserts/packages-item-building.mjs`
that fails a `src/formatName.ts` exporting `formatNames`), or record the
deliberate exception where a reader will meet it — the current explanation lives
only in a YAML comment. Decide this BEFORE the baseline run: changing the case
after recording invalidates its two cells.

## Do not revert: the removed `validate` guard

The turn deleted run-turn.mjs's `expected no validate step` guard. That is
correct and must stay deleted, even though task 4's box "Every trial still
reports an empty `validate` step" reads otherwise — the spec's premise is
factually wrong. A `mode: qa` / `mode: review` state resolves a built-in
validator with no `modes:` config present (`src/SteeringMode.ts`
`resolveSteeringMode` falls back to the built-in format's own parser). Measured
on the actual fixtures: `design-triage`, `architecture-author`,
`build-review-reviewing` and `build-review-collecting` all return a NON-EMPTY
`gtd next --json=validate`; the other five return empty. Restoring the guard
would fail 8 of 18 trials at startup.
