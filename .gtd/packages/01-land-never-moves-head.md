# Package 1 — `gtd land` never moves HEAD

Delete the initial-state collapse, so `land` emits either one commit or nothing.
A process re-entering the initial state having retained nothing lands **an
ordinary commit instead of rewinding**.

## Requirement

### `gtd land` never moves HEAD

PRODUCT — settled by the sketch, no question.

Remove the initial-state collapse: `collapsesWith`, `collapsesToInitialState`,
and `retainHistoryStep` in `src/Edge.ts`, plus the `mixedResetTo` branch in
`renderDecision`. A process re-entering the initial state having retained
nothing lands **an ordinary commit instead of rewinding**.

The prices, stated plainly and not to be traded away:

- `gtd --entry fix-precheck` against a green suite leaves **two commits** in the
  log instead of none. That is accepted, not a regression to fix later.
- `LandResult.settled` loses one of its two sources. It now means only "a no-op
  at a `script` rest" — `Edge.ts`'s `noOpSettles` becomes its sole decider, and
  `program.ts`'s `planLanding` no longer asks git anything to fill it.
- `HISTORY_REF` loses its second writer; `restore` becomes purely `abandon`'s
  inverse.

Acceptance: an e2e scenario entering `fix-precheck` against a green suite ends
with the entry commit and the probe commit both present in the log, and
`gtd land --json` reporting `settled: false`. Today the same scenario ends at
the process start hash with nothing in the log.

Blast radius to carry in the same concern, because each one reds the suite on
its own: `src/Install.ts`'s briefing text about `settled`'s two shapes,
`src/testing/EmittedScriptRecognizer.ts`'s mixed-reset recognition, AGENTS.md's
`collapsesWith` paragraph, `docs/configuration.md`, and the e2e features that
assert the collapse — `land.feature`, `retained-history.feature`,
`smoke.feature`, `fix-entry.feature`, `driver-doc.feature`,
`driver-json-status.feature`, `machine-memory.feature`, `summary.feature`,
`deciding-signoff.feature`.

## Two corrections to the requirement, found by reading the code

**`src/testing/EmittedScriptRecognizer.ts` needs no change**, contrary to the
blast-radius list above. `runAbandonCommand` (`src/program.ts:487-490`) emits
the identical `updateRef(HISTORY_REF, tip)` + `mixedResetTo(startParentHash)`
pair, so both recognizer branches keep a live production caller. Touching them
reds `abandon.feature`.

**`changedPathsSince` goes too.** `retainsNothing` was its only production
caller, so the `GitOperations` port operation dies with the collapse and the
contract drops from **19 operations to 18**.

## Tasks

### Task 1 — Delete the collapse from `src/Edge.ts`

Delete `collapsesWith`, `collapsesToInitialState`, `retainHistoryStep` and
`retainsNothing`. `renderDecision`'s body becomes
`[{ kind: "gitWrite", command: commitAll(...) }, commitDecisionOutcome(decision)]`.

With both git reads gone, `renderDecision` loses its `git` parameter and its
`Effect` wrapper and becomes a plain function
`(rest, decision, cost, model) => readonly EmitStep[]`. `buildStepScripts` loses
its `Effect.catchAll` render-failure fallback — with no git call and no template
render left, there is no failure mode to catch.

`EMPTY_TREE` stays. Line 377 still needs it for `startParentHash`.

- [ ] `src/Edge.ts` exports no `collapsesWith`, `collapsesToInitialState`,
      `retainHistoryStep` or `retainsNothing`
- [ ] `renderDecision`'s signature takes no `GitOperations` and returns
      `readonly EmitStep[]`, not an `Effect`
- [ ] `src/Edge.test.ts` passes with the collapse-branch cases deleted
- [ ] `EMPTY_TREE` is still used at `src/Edge.ts`'s `startParentHash` derivation

Paths: `src/Edge.ts`, `src/Edge.test.ts`

### Task 2 — Narrow `settled` in `src/program.ts`

`planLanding`'s commit branch sets `settled: false` outright instead of awaiting
`collapsesToInitialState`. `buildRequiredScript` drops its `GitService` yield.
`LandResult.settled`'s doc comment narrows to the one shape: a no-op at a
`script` rest.

**`LandResult.settled` keeps its name.** Renaming it breaks `--json`/`--sh` and
the documented driver contract for no gain.

- [ ] `planLanding` calls no git operation to fill `settled`
- [ ] `gtd land --json` at a commit decision reports `settled: false`
- [ ] `gtd land --json` at a no-op at a `script` rest still reports
      `settled: true`
- [ ] `LandResult.settled`'s doc comment names one shape, not two

Paths: `src/program.ts`, `src/program.test.ts`

### Task 3 — Delete `retainHistory` and `COLLAPSED_TEXT`

Delete `retainHistory` from `src/RetainedHistory.ts` — its only callers are its
own tests, and the `deadcode` task would flag it. Delete `COLLAPSED_TEXT` from
`src/OutcomeScript.ts` — `src/Edge.ts` was its only caller.

`HISTORY_REF`, `readRetainedHistory`, `restorability` and `clearRetainedHistory`
all stay: `gtd abandon` still writes the ref and `gtd restore` still reads it,
so `restore` becomes purely `abandon`'s inverse.

- [ ] `src/RetainedHistory.ts` exports no `retainHistory`
- [ ] `src/OutcomeScript.ts` exports no `COLLAPSED_TEXT`
- [ ] `HISTORY_REF`, `readRetainedHistory`, `restorability` and
      `clearRetainedHistory` are unchanged
- [ ] `npm run deadcode` is green

Paths: `src/RetainedHistory.ts`, `src/RetainedHistory.test.ts`,
`src/OutcomeScript.ts`, `src/OutcomeScript.test.ts`

### Task 4 — Delete the `changedPathsSince` port operation

Delete the method from the `GitOperations` interface and its Live implementation
(`src/Git.ts`), its fake (`src/testing/GitDoubles.ts:64`), and its name plus its
whole contract group from `src/testing/GitTiers.ts`.
`InMemRepo.changedPathsBetween` loses its own only caller in the same move, so
it goes with it.

**`AGENTS.md` states "19-operation" as a literal number and must be edited in
the same commit**, or the doc lies about the contract it describes.

- [ ] `GitOperations` declares 18 operations; `src/testing/GitTiers.ts`'s
      operation-name list has 18 entries
- [ ] `src/testing/InMemRepo.ts` declares no `changedPathsBetween`
- [ ] `AGENTS.md` says "18-operation", not "19-operation"
- [ ] `runGitServiceContract` passes against both the fake and a real git repo

Paths: `src/Git.ts`, `src/Git.test.ts`, `src/testing/GitDoubles.ts`,
`src/testing/GitTiers.ts`, `src/testing/InMemRepo.ts`, `AGENTS.md`

### Task 5 — Update the docs and briefing

`src/Install.ts`'s briefing describes `settled` as having two shapes (the
`settled` line at 186) — narrow it to one. `AGENTS.md`'s `collapsesWith`
paragraph, `docs/configuration.md` and `docs/driver.md:519` all describe the
collapse as live behaviour.

`docs/**` is in `test:unit`'s and both e2e tasks' `inputs`, so a stale doc reds
the suite rather than caching green.

- [ ] `src/Install.ts`'s briefing names one terminal shape for `settled`
- [ ] `AGENTS.md` has no `collapsesWith` paragraph
- [ ] `docs/configuration.md` and `docs/driver.md` describe no retain-and-rewind
      landing
- [ ] `npm test` is green

Paths: `src/Install.ts`, `src/Install.test.ts`, `AGENTS.md`,
`docs/configuration.md`, `docs/driver.md`

### Task 6 — Update the e2e features that assert the collapse

Each of these reds the suite on its own.

- [ ] `tests/integration/features/fix-entry.feature`: entering `fix-precheck`
      against a green suite ends with **both the entry commit and the probe
      commit present in the log**, and `gtd land --json` reporting
      `settled: false`
- [ ] `land.feature`, `retained-history.feature`, `smoke.feature`,
      `driver-doc.feature`, `driver-json-status.feature`,
      `machine-memory.feature`, `summary.feature` and `deciding-signoff.feature`
      all pass with no collapse assertion left
- [ ] `abandon.feature` is untouched and passes — `abandon` keeps its own
      retain-and-rewind pair

Paths: `tests/integration/features/land.feature`,
`tests/integration/features/retained-history.feature`,
`tests/integration/features/smoke.feature`,
`tests/integration/features/fix-entry.feature`,
`tests/integration/features/driver-doc.feature`,
`tests/integration/features/driver-json-status.feature`,
`tests/integration/features/machine-memory.feature`,
`tests/integration/features/summary.feature`,
`tests/integration/features/deciding-signoff.feature`

## Out of scope

Three things keep `land`'s emitted script a script rather than a bare
`git commit`, and are not up for removal: **the `expectedHead` assertion, the
`index.lock` retry, and the empty-commit hook fallback** (`--allow-empty`, then
`--no-verify` on a hook rejection).

Also unchanged: **calling `land` is itself the assertion that a beat was
dispatched** — that is what the empty attempt commit records and `stalledAt`
reads.

This package adds no dependency, no CLI flag, no config key and no turbo task.
It only deletes.
