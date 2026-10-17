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
