## correctness

Traced: `runSummaryCommand` → `summaryFor` → `locateSlice` → `replayedSlices` →
`replayFinishedProcess`, plus `gtd slices` and `gtd history` on the same shared
path. Read-only commands: no writes, no saved ids, no retry path. One config
load now feeds both the template check and the replay (was two loads). The
empty-trace, missing-template and edited-config-dropped-summary orders match the
old behaviour, and tests cover them. The dropped `narrowToSlice` guard can no
longer be hit, because `locateSlice` builds the slice from the same `run` inside
the same call. No new mocks.

**Nit**

1. **The new doc comment says the warning comes "before any refusal". For two of
   the three `--slice` refusals it comes after.** (`src/cli/Program.ts:329-330`,
   `src/edge/Edge.ts:1724`)
   - **Problem:** Only the unknown-slice refusal prints the warning first,
     through `Narrator.warn`. The config-drift and divergence refusals put it
     inside the error itself, as `${err.message}\n${versionWarning}`. So it
     shows after the `refused —` line, and under `--json` it also lands in the
     error envelope's `prompt` field. The same thing now happens to
     `gtd history` refusals. `docs/cli.md` L430-434 calls the warning its own
     stderr line, separate from the message.
   - **Fix:** Make the comment true. Either say "the unknown-slice refusal
     prints the warning first; a replay refusal carries it in its message", or
     raise a `GtdError` whose `detail` holds the warning line, so it is kept
     apart from the message. Deferred note-1 (eda53bb) already reopens this
     comment, so the fix can go in with it.

## ponytail-review

What this change does: `gtd summary --slice` now goes through one call,
`summaryFor(run, sliceName)`, which loads the config once, replays only for a
named slice, and returns the prompt plus an optional version warning or
unknown-slice refusal. Replay refusals for `gtd slices`, `gtd summary --slice`
and `gtd history` now carry the version warning in their message. Load assumed:
one person running a read-only CLI command; no scale concern.

Traced: all `summaryFor` callers (only `runSummaryCommand`), `replayedSlices`
callers (`processSlices`, `locateSlice`), `replayFinishedProcess` callers
(`replayedSlices`, `historyTrail`). Every error `withWarning` rewraps is a plain
`Error` (`configRefusal`, `slicesDivergence`, `notClosedError`/`replayError`),
so rewrapping loses no type or exit code. Slice ranges come from `sliceRangesOf`
over the same `run`, so the removed `narrowToSlice` guard is unreachable. New
tests would fail with the guarded behaviour removed (warning on refusal, unknown
slice keeps warning, no-summary returns no prompt).

**Nice to have**

1. **`SummaryResult` is exported but nothing imports it**
   (`src/edge/Edge.ts:1491`)
   - **What this is:** The result type of `summaryFor`.
   - **Problem:** It is not re-exported from `src/edge/index.ts` and no other
     module names it; `Program.ts` destructures the value without the type.
   - **Fix:** Drop `export`. One word.
   - **If we skip it:** A stray public-looking type that suggests a contract
     nobody uses.

Verdict: Ship. Lean: -1 word possible.
