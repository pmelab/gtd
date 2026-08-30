# Record the two new baseline cells

## Requirement

**TECHNICAL.** The new case adds
`claude-opus-sonnet|architecture-decompose|clean` and `...|violation` to the
run. `compareCells` fails any cell present in the run but absent from
`evals/baseline.json` with "not recorded in baseline", so **every full
`npm run eval` reds until the cells are recorded**.

**Acceptance:** `evals/baseline.json` holds both new cells, recorded off a run
that measured them at 4/4, with every pre-existing cell carried forward
untouched.

**Primary path:** `evals/baseline.json`, and nothing else. No code changes.

This is deliberately separate from the eval case itself. Recording is a human
action off a real eval run — multi-minute agent turns, real tokens — and
`npm run eval` is not part of `npm test`, so the case lands with the suite green
and this work is gated on a run someone chooses to pay for.

## Task 1 — Run the eval and record the two new cells

The run was deliberately FILTERED rather than full, and the recording was a
hand-merge rather than `npm run eval:baseline`. A full run is 20 cells x 4
trials of multi-minute agent turns; the filter covered the two new cells plus
the three whose prompt changed after `evals/baseline.json` was recorded
(`fixFeedbackPrompt` was rewritten in `866639ff`, after the baseline's
`recordedAt`), which is the only part of the matrix a full run would have told
us anything new about:

    npm run eval -- --filter-pattern '^(architecture-decompose|build-fix|packages-item-fix-suite|packages-item-fix-spec):'

All eight cells came back 4/4.

**Do not run `npm run eval:baseline` off a filtered run.** It rewrites
`evals/baseline.json` wholesale from `evals/results.json`, and a filtered
`results.json` covers only the cells that ran — recording from it erases every
other cell. The two new cells were merged into the existing `rates` object by
hand instead, refusing any cell not at 4/4 of `trials` and leaving the
pre-existing cells and `recordedAt` untouched. `recordedAt` stays at the
original recording's timestamp on purpose: bumping it would claim the unmeasured
cells were re-measured.

**Risk accepted: the cells that did not run are carried forward unmeasured.**
Their recorded rates were measured against prompts and graders that have not
changed since, so the expected result is green — but expected is not measured,
and the next full `npm run eval` is where that gets confirmed.

- [x] The eval run that produces `evals/results.json` covers both new cells and
      every cell whose prompt or grader changed since the baseline was recorded
- [x] Both new cells' measured rates are read before recording, and each is 4/4
- [x] `evals/baseline.json` holds
      `claude-opus-sonnet|architecture-decompose|clean` and
      `claude-opus-sonnet|architecture-decompose|violation`
- [x] All eighteen pre-existing cells are still present in `evals/baseline.json`
      with their prior rates
- [x] `evals/baseline.json` was NOT written by `npm run eval:baseline` off the
      filtered run
