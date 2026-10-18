# Review: 9ca36e1

<!-- base: 772d69db65e8c1c5a1a20b95a22927ce542eccc9 -->

**One file, pure refactor, no behaviour change.** No `.feature` scenario
touched, so no Scenarios chunk.

## planStates builds its list as one expression

**The mutable `states` array plus `for … push` becomes a single returned array
literal: the `defaults` state, then one spread state per release flag.** Same
order, same labels, same task sets, same pinned env. Net -1 line. All 15 cases
in `tests/tooling/test-states.test.ts` pass, including order and
one-flag-per-state checks.

- [ ] ./scripts/test-states.ts#45-52 — array literal replaces push loop; no risk
