feat(machine): add pure xstate fold core

Add xstate v5 and `src/Machine.ts`: typed COMMIT/RESOLVE events, machine
context, leaf-state union, guarded priority transitions, auto-advance tags, and
a pure `resolve(events)` helper. `maxVerifyIterations` is a hardcoded constant
(5). Covered by `src/Machine.test.ts` (counter folding + every leaf).
