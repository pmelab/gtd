# Spec feedback: 03 — eval cases for the remaining prompts

Tasks 1-7 land as specified: nine cases, one provider entry,
`label|case|variant` keys, the shared grader core, per-case graders, the stated
reason for `architecture.decompose`, and 18 `tests:` entries. **Task 8 is not
done, and the committed baseline does not describe the code in the tree.**

## 1. `evals/baseline.json` was recorded before the last four fixture fixes

`recordedAt` is `2026-08-30T03:46:44.797Z`; it was committed in `6d3680aa`. Five
files changed AFTER that commit:

- `evals/cases/build-fix.mjs` — `expect[*].gtdFiles` `[]` →
  `[".gtd/FEEDBACK.md"]`
- `evals/cases/packages-item-fix-suite.mjs` — same change
- `evals/cases/build-review-collecting.mjs` — the `violation` `REVIEW_RAW.md`
  note rewritten so `src/retry.ts` is the subject of the human's quoted sentence
- `evals/cases/packages-item-building.mjs` — comment only
- `evals/run-turn.mjs` — `readFeedback` exported

Those are grading-contract changes, not cosmetics. The recorded cells for
`build-fix` and `packages-item-fix-suite` grade a `gtdFiles` expectation that no
longer exists. Task 8 requires the record to be the LAST action, after every
case is wired.

## 2. The gate is red today, on cases that did not change

The last run (`evals/results.json`, untracked, newer than the baseline commit)
scores below the committed baseline on five cells:

| cell                                | baseline | last run |
| ----------------------------------- | -------- | -------- |
| `architecture-author\|clean`        | 4/4      | 3/4      |
| `design-triage\|clean`              | 2/4      | 1/4      |
| `build-review-reviewing\|violation` | 2/4      | 1/4      |
| `build-fix\|violation`              | 1/4      | 0/4      |
| `packages-item-building\|violation` | 4/4      | 3/4      |

`architecture-author`, `design-triage` and `build-review-reviewing` were **not
touched between the two runs** — identical case file, identical grader,
identical `run-turn.mjs` path. So this is not explained by the later edits:
`npm run eval` fails `evals/compare-baseline.mjs` against the file as committed.
Task 8's "`npm run eval` passes its own regression gate against the recorded
file" is unmet.

## 3. Three cells are recorded at 0/4

`packages-item-fix-suite|clean`, `packages-item-fix-suite|violation` and
`build-review-collecting|violation` are all `{passed: 0, total: 4}`. A 0/4 floor
can never regress, so those three cells gate nothing — the case is decorative.
The spec names this exact failure: "Treat a suspiciously low cell as a flake to
re-run, not a number to write down." The fixes meant to lift them (the
`.gtd/FEEDBACK.md` deletion expectation, the reworded review note) landed after
the record, so the 0s describe fixtures that no longer exist.

Four more cells are coin flips as recorded — `build-fix|clean` 2/4,
`build-fix|violation` 1/4, `design-triage|clean` 2/4,
`build-review-reviewing|violation` 2/4. A floor at or below 50% flakes both
ways: it reds a healthy prompt on a bad draw and hides a real regression on a
good one.

## What the fix turn owes

One `npm run eval`, on the tree as it stands, then `npm run eval:baseline` —
once, at the end, per task 8. Before spending it: decide what to do about any
cell that comes back at 0-2/4. Recording it is what the spec forbids; the
alternatives are fixing the fixture or the grader, or stating in the case file
why that rate is the honest floor. Do not hand-edit `evals/baseline.json`.

## 4. `packages-item-building` contradicts two task checkboxes, and argues with

the spec in a code comment

`evals/cases/packages-item-building.mjs` declares
`artifact: "src/formatName.ts"`. Task 5 says "declares no `artifact`, and its
grader does not look for one"; task 2 lists it as the one case with `artifact`
absent. The code's reason is sound — without a read-back path `checkNoOverreach`
has nothing to grep and the two variants grade identically — so the deviation
should stand.

What should not stand is the 16-line `RECONCILIATION:` block that carries the
argument. `AGENTS.md`: a comment holds a decision and its reason at the code it
constrains, never history and never a walkthrough. Cut it to one line stating
why this case reads back a source file (the variants are otherwise
indistinguishable) — the surrounding comment already says that. The spec
checkbox is settled by this review, not by a paragraph in a `.mjs`.

Same trim, smaller, in three other case files, each of which narrates a draft
that no longer exists:

- `packages-item-fix-suite.mjs` — "An earlier draft required `[]` here on the
  mistaken assumption…"
- `packages-item-fix-spec.mjs` — "Measured: an earlier draft asserted the BUGGY
  behaviour…"
- `design-triage.mjs` — "Measured: an earlier draft left…"
- `build-review-collecting.mjs` — "Even the file path failed 4/4 on a first
  attempt…"

Keep the constraint each one protects (choose text the fix must INTRODUCE; the
planted path must be the subject of the human's own sentence). Delete the draft
history around it.

## Not a defect — do not "fix" this

Task 4's checkbox "Every trial still reports an empty `validate` step" rests on
a false premise: a built-in `mode: qa`/`review` state validates in-process and
carries a validate script regardless of whether the fixture sets `modes:`, so
there is no empty step to assert. `evals/run-turn.mjs` reads but never executes
it and says so, and `docs/development.md` states the consequence (a trial can
score a structural pass on an artifact `gtd validate` would reject). That is the
right call. Leave it.
