Task 8 is still entirely undone, and one task-3 checkbox is still unmet. The
previous round's other four findings are fixed and verified.

## Task 8: the baseline was never re-recorded, and no new case has ever run

`evals/baseline.json` is byte-for-byte the pre-rekey file: two cells,
`gemini-3.5|clean` and `gemini-3.5|violation`, both 4/4, `recordedAt`
`2026-08-29T11:22:35.457Z`. `git log -- evals/baseline.json` still shows
`819447e1` as its last change — an earlier lap, before any of the eight new case
files existed.

`evals/results.json` proves the run never happened either: 8 trials, timestamp
`2026-08-29T11:20:45.028Z`, and every entry's `vars.case` is `undefined` — a
pre-rekey run. The case files were written at 13:55–14:25. **No case other than
`spec-review` has ever been executed once**, so tasks 1–7 are unverified as well
as unrecorded: a fixture that refuses at `gtd --entry`, a state whose landed
diff does not match its `expect[variant].gtdFiles`, or a grader that fails every
trial would all look exactly like this.

Four task-8 checkboxes fail:

- It carries 2 cells, not 18.
- Both `gemini-3.5|clean` and `gemini-3.5|violation` still remain.
- No key is shaped `gemini-3.5|<case>|<variant>`.
- `recordedAt` does not correspond to a run of this config.

As committed, `npm run eval` reds with 2 baseline cells missing from the run
plus 18 run cells unrecorded — 20 gate violations, exactly the risk task 1 named
when it said the rekey and the record must ship together.

Run `npm run eval` once at `--max-concurrency 2`, fix whatever the first real
run exposes, then `npm run eval:baseline`, and commit the result. Do not
hand-edit the JSON. Do not record a suspiciously low cell — re-run it, because
`evals/compare-baseline.mjs` only fails on a rate that DROPS, so a low cell
becomes a permanently lowered floor.

## Task 3: every grader still throws on malformed output

Checkbox: "No grader throws on malformed output; each returns a failing verdict
with a reason." All nine `evals/asserts/<name>.mjs` open with a bare
`const result = JSON.parse(output)` outside any `try`. `evals/run-turn.mjs`
exits 1 with plain text on stderr for every precondition failure (unknown case,
unserved model, agent turn timeout, oxfmt breakage), so any of those makes
`JSON.parse` throw inside the assert and kills the trial with a parse error
instead of a graded failure — in a 72-trial, hours-long run that is the one
place a reason matters most.

Wrap the parse (in `runChecks`, or in a shared `parseResult` helper the graders
call) and return `{pass: false, score: 0, reason}` naming the unparseable output
instead.

## Minor: `packages-item-fix-suite`'s fixture has no package file

Task 5 states the prerequisite plainly: "`packages.item.*` need a package file."
`evals/cases/packages-item-fix-suite.mjs`'s `base` is `.gtd/FEEDBACK.md` +
`src/parseAmount.ts` only — no `.gtd/NEXT.md`, unlike `packages-item-building`
and `packages-item-fix-spec`, which both carry one. The `fix-suite` prompt does
not itself read the package file, so this may be harmless; either add the
package file or record in the case's comment why this one state does not need
it.

## Not a defect: the removed "expected no validate step" guard

Task 4's checkbox "Every trial still reports an empty `validate` step" rests on
a false premise, and the build turn was right to drop the guard rather than the
behaviour. `resolveValidateScript` in `src/program.ts` emits a non-empty script
whenever the resting state declares both `file:` and `mode:`, and the built-in
`qa`/`review` modes resolve with no `modes:` config at all — so four of the five
planner cases would fail at startup with the old assertion. No change needed
here; do not "restore" it.
