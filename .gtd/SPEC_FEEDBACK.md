# Spec feedback — package 01, `gtd land` never moves HEAD

Tasks 1–5 are complete and verified, the four findings from the previous
feedback round are all addressed, and `npm test` is green (9/9 tasks). One Task
6 file the spec named was never touched and still describes the deleted collapse
as live behaviour.

## `tests/integration/features/machine-memory.feature` still names the collapse

Task 6 lists this file among the features to update. It carries two stale
references, both asserting a mechanism that no longer exists:

- **Line 428** (scenario title): "…reviewing and collecting share the session
  even on the collapsed entry". The `--entry fix-precheck` entry no longer
  collapses — Task 1 deleted the collapse, and `fix-entry.feature` /
  `land.feature` now pin that the same route lands **two commits** and reports
  `settled: false`.
- **Line 443** (comment): "pinned here specifically for the collapsed
  fix-precheck entry, since that's the one route where build.fix opens the scope
  directly rather than resuming it". The clause after the comma is still true
  and is the scenario's whole point; the word "collapsed" is the only false
  part.

Fix: drop "collapsed" from both — "even on the fix-precheck entry" and "for the
fix-precheck entry". The distinguishing property of that route is that
`build.fix` opens `build`'s scope directly, not that anything collapses.

Nothing enforces this text, so the suite stays green either way — this is the
same class of stale prose the previous round's items 1, 3 and 4 were, in a file
the spec's own blast-radius list names.

## Verified clean

- `src/Edge.ts` exports none of `collapsesWith`, `collapsesToInitialState`,
  `retainHistoryStep`, `retainsNothing`; `renderDecision` is
  `(rest, decision, cost, model) => readonly EmitStep[]` with no `GitOperations`
  and no `Effect`; `buildStepScripts` has no render-failure `catchAll`;
  `EMPTY_TREE` still feeds `startParentHash` at line 376.
- `planLanding` sets `settled: false` outright with no git call; `noOpSettles`
  is the sole decider and its doc names one shape.
- `retainHistory` and `COLLAPSED_TEXT` are gone; `HISTORY_REF`,
  `readRetainedHistory`, `restorability`, `clearRetainedHistory` unchanged.
- `changedPathsSince` and `InMemRepo.changedPathsBetween` are gone.
  `GitOperations` declares **19** methods and `CONTRACT_COVERED_OPERATIONS`
  lists **19** names; `AGENTS.md:145` and `GitTiers.ts:355` both say 19. The
  spec's "18" came from `AGENTS.md`'s figure, which was already stale by one
  against the real interface (20 before the deletion) — **19 is correct and the
  literal "18-operation" criterion in Task 4 must not be honoured**, since
  writing 18 would restore the lie the criterion exists to prevent.
- `docs/configuration.md` needed no edit: its only surviving "collapse"/
  "retain" text is the `commit:`-key and `it.retainedBase` migration FAQ, about
  the already-removed squash finale, not about landing.
- `abandon.feature` untouched; `smoke.feature`, `summary.feature` and
  `deciding-signoff.feature` carry no collapse assertion (their "collapse"
  wording is about other subjects).
