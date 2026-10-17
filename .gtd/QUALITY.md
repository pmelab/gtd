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

## conventions

Read: `AGENTS.md`, `CLAUDE.md` (root; it pulls in only `@AGENTS.md`),
`CONTEXT.md` (the glossary `AGENTS.md` says to read before naming), and the
user's global `CLAUDE.md`. No touched directory has its own `AGENTS.md` or
`CLAUDE.md`. Checked: `docs/cli.md` names no `src/*.ts` module; the new scenario
sits in an `@inmem` feature and shows its config and commit message in full; the
test reaches `summaryFor` from inside its own boundary; no other documentation
was added.

**Should fix**

1. **`refusal` field uses a glossary term with a different meaning**
   (`src/edge/Edge.ts` `SummaryResult.refusal`, `locateSlice`'s `{ refusal }`
   branch)
   - **Rule:** AGENTS.md says "`CONTEXT.md` … the domain language this repo uses
     … Read it before naming anything". CONTEXT.md defines "**Refusal**: A
     landing rejected before anything is captured — a guard saying no, or the
     flow calling `refuse()`".
   - **Problem:** an unknown `--slice` name is a read-only CLI command rejecting
     its argument, not a rejected landing. A typed field called `refusal` makes
     the code's vocabulary disagree with the glossary. Divergence and
     config-differs errors take the `Error` channel, but this one gets a field
     named after a domain term it is not.
   - **Fix:** rename it to something neutral, e.g. `unknownSlice` (or `error`).
     Only the CLI and two tests read it.

**Nice to have**

2. **New and edited comments state "what" without "why"** (`src/edge/Edge.ts`
   `narrowToSlice` JSDoc; `src/cli/Program.ts` `runSummaryCommand` JSDoc
   addition)
   - **Rule:** "Keep a comment … only where it explains an important decision or
     genuinely unclear code … Everything else (restatement of the code … a
     'what' with no 'why') gets deleted, not moved."
   - **Problem:** the old `narrowToSlice` comment explained why a guard existed.
     This change removed the guard and replaced the comment with "The trace
     window and cost entries of `slice`, or the whole run's when there is none",
     which only repeats the first line of the body. The new `runSummaryCommand`
     sentence lists refusals that `summaryFor` and `replayedSlices` already
     produce. If the list goes stale, nothing fails.
   - **Fix:** delete the `narrowToSlice` JSDoc. Drop the added `--slice`
     sentence. If one fact is worth keeping there, keep the decision "the edge
     never narrates; the CLI prints `versionWarning` before any refusal" and
     drop the list.

3. **Test names use "drift" for an edited config** (`src/edge/Edge.test.ts`:
   `…when the drifted config no longer exports a summary`,
   `plain summaryFor still returns a prompt under a drifted config…`)
   - **Rule:** CONTEXT.md, Divergence: "_Avoid_: drift, stale state, migration".
   - **Problem:** these two new names use the word the glossary bans. Older
     tests in the file use it too, but this change adds more.
   - **Fix:** "an edited config" / "a config edited since the close".

## spec-challenge

Planning docs read: `REQUIREMENTS.md` (0aad07ae), `ARCHITECTURE.md` (b4b6422e),
packages 01/02 (d3f2a201). Checked each decision against tests, `docs/cli.md`,
`CONTEXT.md` and the data the replay relies on.

**Should fix**

1. **Spec premise "replay refusals never coexist with a warning" is false**
   (ARCHITECTURE.md, Answered Questions, "How does the unknown-slice refusal
   carry the version warning out of the edge?": "Replay refusals stay failures;
   they never coexist with a warning")
   - **Decision:** only the unknown-name refusal gets returned with
     `versionWarning`. Divergence and config-edited refusals stay `Error`
     failures with no warning attached.
   - **Invariant it conflicts with:** `docs/cli.md` "Narration and remediation"
     (edited by this change) says `gtd summary --slice` prints the WARNING when
     a finished process was recorded by another gtd version. The recorded
     version is parsed from the closing commit message (`replayFinishedProcess`,
     `src/edge/Edge.ts` ~L1726). It does not depend on the replay, so it is
     known on every closed-process path.
   - **Why the premise fails:** a gtd upgrade changes the shipped workflow code
     (`@pmelab/gtd/workflows`, imported by `gtd.config.ts`) without editing any
     config file. So `differingConfigPaths` passes, the replay stops ending, and
     `slicesDivergence` fails before `versionWarningFor` runs. Divergence under
     another gtd version is the main case where the two happen together. The
     same gap reaches `gtd slices` and `gtd history show`, which share
     `replayFinishedProcess`. This is the root cause of ponytail-review #1 and
     test-audit #4. It is a spec error, not an implementation slip, so a fix
     that only follows the spec cannot close it.
   - **Fix:** in `replayFinishedProcess`, work out `recorded`/`versionWarning`
     before the config check and the replay. Append it to the refusal error on
     both failure branches. That one change covers all three commands. Pin it
     with one Edge test (0.0.1 tip + config that does not end). Or, if this is
     deferred, narrow the `docs/cli.md` sentence to "when the replay succeeds".
   - **If we skip it:** the doc promises a warning that is missing in exactly
     the case that needs it.

Checked, no conflict: removing the `narrowToSlice` guard is safe. Slice
`base`/`tip` come from `sliceRanges`, built from the same `run`'s
`startParentHash`, trace tip and replayed `leftAt`, so the guarded case cannot
happen. Turning a returned `refusal` into an `Error` in the CLI keeps the
runtime-error exit code that the pinned exit-code table expects. Running the
template check before the empty-trace check keeps the pinned "--slice on a fresh
idle repo is refused" stderr. `costTotals` returning `Rest["cost"]` keeps
`gtd next --json`'s `cost` shape and `costByModel`'s order.
