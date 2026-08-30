# Spec feedback — 03 Build eval cases for the remaining prompts

Two problems. Task 8 (re-record the baseline) is not satisfied, and
`docs/development.md` breaks this repo's documentation rule.

## 1. `evals/baseline.json` was recorded BEFORE the cases it grades were fixed

`evals/baseline.json` carries `recordedAt: 2026-08-30T03:46:44.797Z` and was
committed in `6d3680aa` (2026-08-30 06:22:50 +0200). Commit `8aa77139`
(2026-08-30 06:34:24 +0200) then changed the grading contract of three cases,
and the baseline was never re-recorded. Task 8 requires the record to be the
LAST action, after every case is wired; it currently sits before two case fixes.

Cells measured against a contract the code no longer uses:

- `packages-item-fix-suite|clean` and `|violation` — `expect[variant].gtdFiles`
  changed from `[]` to `[".gtd/FEEDBACK.md"]`.
- `build-fix|clean` and `|violation` — same change.
- `build-review-collecting|violation` — the `violation` fixture's
  `.gtd/REVIEW_RAW.md` prose was rewritten so `src/retry.ts` is the grammatical
  subject of the human's quoted sentence, which is exactly the change that moves
  the `plantedIdentifier` grep floor's hit rate.

The stale run is still on disk: `evals/results.json` (gitignored, from a run
started 2026-08-30T03:47:27Z) shows all four `packages-item-fix-suite|clean`
failures with the single reason
`gtdFilesChanged was [".gtd/FEEDBACK.md"], expected []` — the very expectation
`8aa77139` corrected. So the recorded `0/4` is the old grader being wrong, not
the model failing.

That realizes the risk the spec names by name: **a cell recorded below its true
rate is a permanently lowered floor.** `evals/compare-baseline.mjs` only fails
on a rate that DROPS, so the three `0/4` cells (`packages-item-fix-suite|clean`,
`packages-item-fix-suite|violation`, `build-review-collecting|violation`) can
never fail again — three of eighteen gate cells are dead.

The gate also does not pass today. Running `node evals/compare-baseline.mjs`
against the results file on disk reports five regressions:

```
gemini-3.5|design-triage|clean: regressed — baseline 2/4, run 1/4
gemini-3.5|architecture-author|clean: regressed — baseline 4/4, run 3/4
gemini-3.5|build-review-reviewing|violation: regressed — baseline 2/4, run 1/4
gemini-3.5|packages-item-building|violation: regressed — baseline 4/4, run 3/4
gemini-3.5|build-fix|violation: regressed — baseline 1/4, run 0/4
```

Task 8's checkboxes "No cell is recorded below the rate its run actually earned"
and "`npm run eval` passes its own regression gate against the recorded file"
are both unmet.

Fix: with no further edits to `evals/cases/*`, `evals/asserts/*` or
`evals/run-turn.mjs` pending, run `npm run eval` once on the current tree, read
the per-cell matrix, then `npm run eval:baseline`, and commit the resulting
`evals/baseline.json`. Any cell that comes back at `0/4` on BOTH variants of one
case is a broken fixture to diagnose, not a number to write down.

## 2. `docs/development.md` names internal source modules

`AGENTS.md`: "Prose in `docs/`, `README.md`, or this file must not name a
`src/*.ts` module, an internal function, or a private type." The
`## Prompt evals` section's `RECONCILIATION:` paragraph names both:

> `resolveSteeringMode` in `src/SteeringMode.ts` falls back to the built-in
> `qa`/`review` parser with no `modes:` config present at all

The same paragraph documents how gtd was BUILT — it narrates a package spec's
task-4 checkbox and which guard was removed from `evals/run-turn.mjs` — which
`AGENTS.md` says to delete rather than keep.

The underlying decision is sound and is worth keeping: a
`mode: qa`/`mode: review` state always resolves a non-empty `--json=validate`,
so the old "expected no validate step" guard could not survive, and the task 4
checkbox "Every trial still reports an empty `validate` step" is a false
premise. But that belongs at the code it constrains — `evals/run-turn.mjs`'s
`driveTurn`, which already carries most of it — not in `docs/`. Delete the
`RECONCILIATION:` paragraph and the `src/SteeringMode.ts` reference from
`docs/development.md`; keep the reader- facing sentence that a `mode:`-carrying
case's artifact is never run through `gtd validate`.
