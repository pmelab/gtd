# Record the two new baseline cells

## Requirement

**TECHNICAL.** The new case adds
`claude-opus-sonnet|architecture-decompose|clean` and `...|violation` to the
run. `compareCells` fails any cell present in the run but absent from
`evals/baseline.json` with "not recorded in baseline", so **every full
`npm run eval` reds until the cells are recorded**.

**Acceptance:** a full `npm run eval` exits clean, and `evals/baseline.json`
holds both new cells.

**Primary path:** `evals/baseline.json`, and nothing else. No code changes.

This is deliberately separate from the eval case itself. Recording is a human
action off a real full run — 20 cells × 4 trials of multi-minute agent turns,
real tokens — and `npm run eval` is not part of `npm test`, so the case lands
with the suite green and this work is gated on a run someone chooses to pay for.

## Task 1 — Run the full eval and record

The procedure is fixed: run a full, unfiltered `npm run eval` with
`GTD_EVALS_URL` and `GTD_EVALS_KEY` set, confirm the two new cells pass, then
run `npm run eval:baseline`, which rewrites `evals/baseline.json` from
`evals/results.json`.

**Do not run `npm run eval:baseline` off a filtered run.** A filtered run skips
the baseline gate and its `results.json` covers only the cells that ran;
recording from it would erase every other cell.

**Risk: a new cell can pass at less than 4/4 and still be recorded.** The
recorder writes whatever rate the run measured, so a flaky cell recorded at 3/4
becomes the bar every later run is compared to. Read both new cells' rates
before recording — a rate below 4/4 is a signal to fix the fixture or the
prompt, not to record it.

- [ ] The eval run that produces `evals/results.json` is full and unfiltered —
      no `--filter-pattern`
- [ ] Both new cells' measured rates are read before recording, and each is 4/4
- [ ] `evals/baseline.json` holds
      `claude-opus-sonnet|architecture-decompose|clean` and
      `claude-opus-sonnet|architecture-decompose|violation`
- [ ] All eighteen pre-existing cells are still present in `evals/baseline.json`
      with their prior rates
- [ ] A subsequent full `npm run eval` exits clean, with no "not recorded in
      baseline" failure
