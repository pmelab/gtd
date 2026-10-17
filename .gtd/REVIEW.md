# Review: b487bd1

<!-- base: 8d1173fbc3e5d7f2c150a4e858f2b876af4960f6 -->

**No defect found; nothing marked `Risk:`.** This round handles the last
review's notes. It adds a scenario for a config-drift refusal that carries the
version warning, merges two duplicate unit tests into one table, documents where
the warning goes on a refusal, and trims doc comments. One note is deferred to
TODO.md.

## Scenarios

- [ ] ./tests/integration/features/slices-command.feature#238-298 —
      **`gtd slices` on a process whose closing commit says
      `Gtd-Version: 0.0.1`, with `gtd.config.ts` edited afterwards, refuses with
      exit 1 and empty stdout.** Stderr carries the refusal, the "revert or
      stash the edit" hint, and the version warning (`recorded by gtd 0.0.1`
      plus the running version). This pins the config-drift path of the warning.
      The replay-divergence path stays covered only by the unit test below.

## Version warning on replay refusals

A replay refusal (config drift or divergence) puts the version warning at the
end of its own message, not on a separate stderr line. **The docs and comments
now say so. Behaviour is unchanged.**

- [ ] ./docs/cli.md#431-436 — New sentence: on a config-drift or divergence
      refusal, the warning is the last line of the message, and of the `--json`
      `prompt`. Matches the edge code, which appends the warning to both refusal
      kinds. **FYI: no scenario covers the `--json` `prompt` half of this
      claim.**
- [ ] ./src/cli/Program.ts#323-332 — `runSummaryCommand` doc comment fixed. The
      old wording said the warning prints "before any refusal", which was false
      for replay refusals. It now says the CLI warns before the unknown-slice
      refusal and a replay refusal carries the warning itself. **The comment
      still names only the two plain refusals.** Adding the three `--slice`
      refusals is the deferred TODO note-1.
- [ ] ./src/edge/Edge.test.ts#905-946 — Two unit tests become one `it.each` over
      the recorded version (`GTD_VERSION`, `0.0.1`). Both rows assert the full
      `gtd summary: refused — <sha> closes a process that does not end under today's config`
      prefix. The `0.0.1` row requires `recorded by gtd 0.0.1`, and the
      current-version row requires that no warning appears. The old pair never
      checked that a current-version run gets no warning, so the merge gains
      coverage. Rewriting the commit message with the current version is a
      no-op, so the first row behaves like the old test.

## Doc and export trims

- [ ] ./src/edge/Edge.ts#1491-1495 — `SummaryResult` is no longer exported.
      Nothing outside `Edge.ts` names it, because callers destructure the
      result.
- [ ] ./src/edge/Edge.ts#1556-1559 — `summaryFor` doc comment cut to the two
      facts the code does not show: a plain call never replays, and under a
      slice `entryCommit` and `marks` stay whole-process. The rest repeated the
      signature and the return type.

## Workflow state

- [ ] ./.gtd/TODO.md#11-17 — Deferred review note from eda53bb: list the
      `--slice` refusals in the `runSummaryCommand` doc comment (unknown slice,
      config edited since close, diverged replay). Marked "could", so it is
      optional.
