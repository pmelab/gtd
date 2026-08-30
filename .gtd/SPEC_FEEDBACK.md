# Spec feedback: 03 — eval cases for the remaining prompts

Tasks 1–7 land as specified. **Task 8 is still not done: the committed
`evals/baseline.json` predates the grading-contract changes now in the tree, and
no run since those changes exists.**

The last fix turn (`2e45068d`) only trimmed comments in six case files. It
changed no behaviour and did not re-record.

## 1. The baseline is older than the contracts it grades

`evals/baseline.json` carries `recordedAt: 2026-08-30T03:46:44.797Z` and was
committed in `6d3680aa` (06:22). Commit `8aa77139` (06:34) then changed three
grading contracts:

- `evals/cases/build-fix.mjs` — `expect[clean].gtdFiles` and
  `expect[violation].gtdFiles` went `[]` → `[".gtd/FEEDBACK.md"]`
- `evals/cases/packages-item-fix-suite.mjs` — same change on both variants
- `evals/cases/build-review-collecting.mjs` — the `violation` fixture note was
  rewritten so `src/retry.ts` is the grammatical subject of the human's quoted
  sentence

Those four `build-fix` / `packages-item-fix-suite` cells and the
`build-review-collecting|violation` cell were recorded against expectations that
no longer exist. Task 8 requires the record to be the LAST action, after every
case is wired.

## 2. `npm run eval` fails its own regression gate against the committed file

`evals/results.json` (untracked, 06:20 — itself older than `8aa77139`) scores
below the committed baseline on five cells:

| cell                                | baseline | last run |
| ----------------------------------- | -------- | -------- |
| `architecture-author\|clean`        | 4/4      | 3/4      |
| `design-triage\|clean`              | 2/4      | 1/4      |
| `build-review-reviewing\|violation` | 2/4      | 1/4      |
| `build-fix\|violation`              | 1/4      | 0/4      |
| `packages-item-building\|violation` | 4/4      | 3/4      |

`architecture-author`, `design-triage` and `build-review-reviewing` were not
touched between the two runs — identical case file, identical grader, identical
`run-turn.mjs` path. The drop is prompt flake against a floor recorded too high,
not a code change. Task 8's checkbox "`npm run eval` passes its own regression
gate against the recorded file" is unmet.

## 3. Three cells are recorded at 0/4, and four more are coin flips

`packages-item-fix-suite|clean`, `packages-item-fix-suite|violation` and
`build-review-collecting|violation` are all `{passed: 0, total: 4}`. A 0/4 floor
can never regress, so those three cells gate nothing. The spec names this exact
failure: "Treat a suspiciously low cell as a flake to re-run, not a number to
write down." The fixes meant to lift them landed after the record.

Four more are at or below 50% as recorded — `build-fix|clean` 2/4,
`build-fix|violation` 1/4, `design-triage|clean` 2/4,
`build-review-reviewing|violation` 2/4. A floor there flakes both ways: it reds
a healthy prompt on a bad draw and hides a real regression on a good one.
Section 2 is that failure already happening.

## What closes this

One `npm run eval` on the tree as it stands now, then `npm run eval:baseline`,
recording all 18 cells — one record for the whole package, never one per case.
`--max-concurrency` stays 2. Any cell that comes back at 0/4 or at a
suspiciously low rate is a flake to re-run before it is written down, not a
number to record.
