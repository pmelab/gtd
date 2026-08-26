# Spec feedback — package 01, `gtd land` never moves HEAD

The deletions, the narrowing of `settled`, the port removal and every e2e
feature change are correct and the suite is green. Four stale references to the
now-deleted collapse survive in comments and docs, and one of them states the
opposite of the contract Task 2 just narrowed.

## 1. `src/Edge.ts:988-990` — `noOpSettles`'s doc still claims TWO settled shapes

The comment ends: "This is one of TWO settled shapes — the other is the
initial-state collapse, decided independently by `program.ts`'s `planLanding`."
`planLanding` now sets `settled: false` outright and the collapse is gone. Task
2's acceptance criterion "`LandResult.settled`'s doc comment names one shape,
not two" is met in `program.ts` but violated at the sole decider the spec names
— `Edge.ts`'s `noOpSettles`. Rewrite the last sentence to say a no-op at a
`script` rest is the ONLY settled shape.

## 2. The operation count is now wrong by one, in two places

`GitOperations` declares **19** methods after the deletion, and
`CONTRACT_COVERED_OPERATIONS` (`src/testing/GitTiers.ts:318-337`) lists **19**
names. Both new numbers say 18:

- `AGENTS.md:145` — "18-operation `GitOperations` contract"
- `src/testing/GitTiers.ts:355` — "Exercise all 18 `GitOperations` methods" (it
  said 20 before, so it dropped by two for a one-operation deletion)

The spec's "19 → 18" was derived from `AGENTS.md`'s figure, which was already
stale against the real interface; following it literally kept the doc lying,
which is the exact failure the spec's own correction called out. Change both to
**19**. Nothing enforces this number, so the suite stays green either way.

## 3. `src/Git.ts:105` — `mixedResetTo`'s doc names the collapse as a caller

"Used by `gtd abandon`'s reset and the initial-state collapse's own reset."
`gtd abandon` is now the only caller. Drop the second clause.

## 4. `src/program.ts:495-496` — `runRestoreCommand`'s doc names the collapse

"hard-reset HEAD back to the tip `gtd abandon` (or the initial-state collapse's
own mixed reset) retained." Contradicts the package's own statement that
`HISTORY_REF` loses its second writer and `restore` becomes purely `abandon`'s
inverse — a change already made correctly in `CONTEXT.md` and
`retained-history.feature`. Delete the parenthetical.

## Not a problem

`src/PatternMachine.ts:343` also says "the flag lets the initial-state collapse
and the step-capture guards tell an attempt apart". Worth trimming to just the
guards while you are in there, but it is prose in a pure module and does not
misstate a live contract the way the four above do.
