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
