## ponytail-review

What this change does: folds `summarySlice` and `hasSummary` into one
`summaryFor(run, sliceName?)` that returns
`{ prompt, versionWarning?, refusal? }`, so `gtd summary --slice <unknown>`
prints the other-gtd-version warning before its refusal. It also moves cost
totalling into a shared `costTotals` helper and drops the now-unreachable "slice
lies outside the process" guard. Load assumed: one person running a CLI command;
no scale concern.

**Should fix**

1. **Version warning still lost when the old-version process no longer replays**
   (`src/edge/Edge.ts:1724-1730`, used by `replayedSlices` at L1125)
   - **What this is:** `replayFinishedProcess` replays a closed process and only
     then works out the "recorded by gtd X" warning.
   - **Problem:** If the replay does not end, it fails at L1725 before L1729
     runs. Case: a process closed by gtd 0.0.1 whose flow no longer ends under
     today's gtd → `gtd summary --slice build` (and `gtd slices`) print only
     "does not end under today's config", with no version hint. That is the case
     where the hint matters most, and `docs/cli.md` L432 now says
     `gtd summary --slice` prints the warning whenever the versions differ. This
     change made only the unknown-name refusal keep the warning.
   - **Fix:** Work out `versionWarning` before the replay, and on the
     `outcome.kind !== "ended"` branch add it to the failing error's message
     (`${err.message}\n${versionWarning}`). Add one Edge test that pairs a 0.0.1
     tip with a config that does not end.
   - **If we skip it:** Users see a bare divergence refusal and cannot tell that
     the cause is a gtd version change.

**Nice to have**

2. **Indirect type for an imported name** (`src/edge/Edge.ts`, `locateSlice`
   signature)
   - **What this is:** `config: Parameters<typeof replayedSlices>[0]`.
   - **Problem:** This is just `ConfigOperations`, which is already imported and
     used by `replayedSlices` itself. The indirection makes a reader go look it
     up.
   - **Fix:** `config: ConfigOperations`.
   - **If we skip it:** Nothing breaks. It is only slower to read.

Checked: every caller of the removed exports (only `src/cli/Program.ts`);
removing the `narrowToSlice` guard is safe because slices now come only from
`locateSlice`, using the same run's replay. The refusal ordering (summary
template first, then the empty trace, then the replay) matches the old CLI
branch. The new Program and feature tests fail if the warning comes after the
refusal or is dropped. The plain-call drift test fails if the plain call
replays.

Verdict: fix 1 first (or defer it explicitly, because the gap predates this
change and also affects `gtd slices`). Lean: -0 lines (2 is a one-token swap).

## test-audit

Lens: does each new/changed test guard a behaviour this change owns, and would
it fail with that behaviour removed. Traced `summaryFor` → `locateSlice` →
`replayedSlices` and the CLI caller against every touched test.

Strong (keep): `returns no prompt … no longer exports a summary` fails if the
summary check moves after the replay; `plain summaryFor … never replaying` fails
if the plain call replays; the empty-trace test now pins the exact refusal text
and the plain call's `{ prompt: undefined }`; the Edge unknown-name test pins
refusal + slice list + warning together.

**Should fix**

1. **`--model=sonnet` and the step-parser change prove nothing**
   (`tests/integration/features/summary-slice.feature:48`,
   `tests/integration/support/steps/history.steps.ts:34`)
   - **What this is:** scenario 1 now lands with `--cost=10 --model=sonnet`, and
     `gtd lands … with` now splits on `/\s+/` after `trim()`.
   - **Problem:** that scenario's `summary` template never renders
     `processCostByModel`, so the model reaches no assertion; drop the flag and
     the scenario passes unchanged. The args are single-space separated, so
     `split(" ")` already gave the same result; no scenario exercises the new
     parsing. Fixture noise that looks like coverage.
   - **Fix:** revert both. (Slice-narrowed by-model cost is already owned by the
     Edge `splits cost by slice` test.) If CLI proof of per-slice by-model cost
     is wanted, add `processCostByModel` to the template and assert it instead.
   - **If we skip it:** a reader believes per-slice model breakdown is covered
     at the CLI when it is not.

**Nice to have**

2. **Unknown-name warning-before-refusal pinned twice at the same tier**
   (`src/cli/Program.test.ts:1885`, `summary-slice.feature` new scenario)
   - **What this is:** both run `gtd summary --slice nope` on a 0.0.1-closed
     process in memory and assert warning precedes refusal on stderr.
   - **Problem:** same contract, same in-memory transport, same failure mode;
     the Edge test already owns the result shape. One CLI owner is enough.
   - **Fix:** keep the `@inmem` feature scenario (repo convention for a
     feature), delete the Program test.
   - **If we skip it:** two tests to update for one wording change.

3. **Plain-vs-named test repeats the slice-resolution test**
   (`src/edge/Edge.test.ts`
   `renders no slice key for the plain call, the exact slice for a named one`)
   - **Problem:** its `verify` `toEqual` is byte-identical to the one in
     `resolves each slice with its range, 1-based index and count`. Only the
     `"slice" in plain === false` half is new proof.
   - **Fix:** reduce it to the plain-call assertion (rename to match).
   - **If we skip it:** duplicate expectation; harmless.

4. **Divergence path has no version-warning test** — same gap as ponytail-review
   #1; whichever way that is decided, the fix needs the Edge test it names
   (0.0.1 tip + non-ending config), since nothing today fails if `docs/cli.md`'s
   new `gtd summary --slice` warning claim is false on that path.

Not a finding: the new `restAt` cost test partly overlaps `token-cost.feature`
(`gtd next --json` breakdown) but uniquely pins highest-first order and guards
the `costTotals` extraction; keep.
