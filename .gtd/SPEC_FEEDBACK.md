The refactor (tasks 1–3), the nine case files, the wiring (task 7) and the
stated reason (task 6) all land as specified. Task 8 does not, and two coder
cases carry a fixture bug that the recorded baseline froze as a permanently dead
cell.

## 1. `npm run eval` fails its own regression gate as landed

Task 8's acceptance "`npm run eval` passes its own regression gate against the
recorded file" is unmet. `node evals/compare-baseline.mjs` against the most
recent local `evals/results.json` (06:20) exits 1 with five regressions versus
the committed `evals/baseline.json` (recorded 03:46):

- `design-triage|clean`: baseline 2/4, run 1/4
- `architecture-author|clean`: baseline 4/4, run 3/4
- `build-review-reviewing|violation`: baseline 2/4, run 1/4
- `packages-item-building|violation`: baseline 4/4, run 3/4
- `build-fix|violation`: baseline 1/4, run 0/4

No case, grader or config file changed between those two runs — every file under
`evals/cases/` and `evals/asserts/` predates both. Same code, two runs, five
differing cells. The baseline was recorded from the luckier of two runs, so the
gate is red for anyone who runs it. Either re-record from a run the current
fixtures actually earn, or bring the flaky cells' rates up before recording.
`--repeat 4` also cannot support a floor gate on a cell that moves by ±1 trial
between identical runs; if the cells stay this noisy the trial count or the pass
rule has to change, and that change belongs in this package, not after it.

## 2. Two coder cases forbid the `.gtd/FEEDBACK.md` change their prompt invites

`unified.yaml`'s `fixFeedbackPrompt` (the body both states render) says
verbatim: "The only state file this turn touches is `.gtd/FEEDBACK.md`; fix it
per its contents, or delete it if the feedback turns out to be wrong." Both
cases nonetheless declare `gtdFiles: []` on both variants, so the shared
`checkGtdFilesChanged` fails any turn that does the thing the prompt invites.

Measured, in the run whose `results.json` is on disk:

- `packages-item-fix-suite`: 8 of 8 trials failed with
  `gtdFilesChanged was [".gtd/FEEDBACK.md"], expected []` — the sole failure
  reason on every trial, both variants.
- `build-fix`: 6 of 8 trials failed with the same reason. The two `clean` passes
  differ from the two `clean` failures only in whether the agent happened to
  touch `FEEDBACK.md`, which is the coin flip driving finding 1's `build-fix`
  instability.

This is a fixture defect, not a model result. `packages-item-fix-spec` proves
the correct shape — it expects `[".gtd/SPEC_FEEDBACK.md"]` and scores 4/4 on
both variants against the same model. Fix the two cases'
`expect[variant] .gtdFiles` to admit the FEEDBACK.md change the prompt contracts
for, and delete the claim in `evals/cases/packages-item-fix-suite.mjs`'s header
comment that the health-check re-run rather than this turn clears that file —
the run contradicts it.

## 3. Three baseline cells are recorded at 0/4 — a floor that can never fail

Task 8 states the rule this breaks: "A cell recorded below its true rate is a
permanently lowered floor — `evals/compare-baseline.mjs` only fails on a rate
that drops. Treat a suspiciously low cell as a flake to re-run, not a number to
write down." `evals/baseline.json` records `build-review-collecting|violation`,
`packages-item-fix-suite|clean` and `packages-item-fix-suite|violation` at 0/4.
A 0/4 cell cannot regress, so the gate is vacuous for those states — three of
the eighteen cells this package exists to create grade nothing.

Two of the three are finding 2's fixture bug. The third is its own defect:
`build-review-collecting|violation` fails 0/4 on the grep floor
(`feedback did not mention the planted identifier "src/retry.ts" verbatim`)
while the artifact is otherwise correct — the landed `.gtd/REQUIREMENTS.md`
carries a well-formed TECHNICAL concern naming the swallowed retry error, and
only omits the path. `evals/cases/build-review-collecting.mjs`'s comment asserts
a file path was chosen because "a classifying agent naturally names the affected
file when writing a concern down"; the measurement says the opposite, 4 times
out of 4. Either pick an identifier the state's output actually reproduces
verbatim, or make the fixture demand the path (its `REVIEW_RAW.md` mentions
`src/retry.ts` only inside prose the model paraphrases away).

## 4. Two acceptance criteria are contradicted by the code with no reconciliation

Both look like deliberate, well-reasoned build-time corrections, but the spec
still says otherwise and nothing records the change. Reconcile each — amend the
spec line or the code, do not leave them disagreeing:

- Task 5: "`packages.item.building` declares no `artifact`, and its grader does
  not look for one". `evals/cases/packages-item-building.mjs` declares
  `artifact: "src/formatName.ts"` and `asserts/packages-item-building.mjs`'s
  `checkNoOverreach` greps that read-back content; the case's `tests:` entries
  also carry an `llm-rubric`, which `docs/development.md` says a case with no
  contracted state file does not. Task 2's "`artifact` — Absent for a case that
  produces no state file (`packages.item.building`)" is the same conflict. The
  code's choice is the defensible one (the two variants are otherwise
  indistinguishable), but no case now exercises `readFeedback`'s absent-artifact
  branch, which task 2 requires to work.
- Task 4: "Every trial still reports an empty `validate` step".
  `evals/run-turn.mjs` never queries `gtd next --json=validate` at all and emits
  no `validate` field, on the stated grounds that a `mode: qa`/ `mode: review`
  state always carries a non-empty validate script — i.e. the spec's premise was
  found false. The consequence is real and only recorded in a code comment: four
  planner cases can score a structural pass on an artifact the real workflow's
  `gtd validate` gate would reject.
