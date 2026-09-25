# Refuse an `each:` entry, and let loop A advance past an empty loop B

## Requirement A — entering an `each:` reference as the workflow's initial state leaves `it.item` empty (Greptile P1)

`initialStateOf` returns `def.entries.default` verbatim — no qualifier, no
snapshot. Item qualification happens only inside `qualifyLoopTarget`, which only
a transition reaches. So if `entries.default` names a state inside an `each:`
subtree, the first prompt or script runs with `it.item` empty.

`resolveState` widens the blast radius: any unrecognised commit subject falls
back to `initialStateOf`, so this is not only a cold start.

Refuse it at load time rather than supporting it. A process may not start inside
an `each:` loop, exactly as manual entry (`gtd --entry`) already refuses any
state inside an `each:` subtree. Add the rule to `validateEntries`, reusing the
same predicate that guards manual entry (exported as `isInEachSubtree`), so the
two doors agree. `resolveState`'s fallback then becomes safe for free — a
default entry that can never sit inside a loop can never land there unqualified.

The rule covers `entries.manual` as well as `entries.default`: a workflow may
not declare an entry point `gtd --entry` will then refuse at runtime.
`validateEntries` already walks both keys through one `checkEntry` helper, so
the check goes there once and fires on either. `manualEntryStates` stays exactly
as it is — it filters `enterableStates` (every declared state), a deliberately
broader set than `entries.manual`, so the load rule does not make it redundant.

Not reachable in the bundled workflow, whose default entry is `idle` and whose
manual entries all sit outside every loop.

Risk: this is a new load error that rejects a workflow which loads today, in two
classes. `validateReachability` only runs when entries validate clean, so a
workflow tripping the new rule will also stop reporting reachability errors in
the same run — the error message alone must be enough to act on.

## Requirement B — an empty second loop makes the first loop skip its remaining items (Greptile P1)

Unambiguous — no product fork; loop A must always finish its items.

Confirmed by reading `step`'s ordering. With loop A's `drained:` pointed at loop
B's reference and B's snapshotted list empty, `qualifyLoopTarget` runs first and
chains B through to B's own `drained:` target. `applyEachDrainAdvance` then runs
against that already-rewritten target and scans for
`baseTarget === ref.drained`. A's `drained:` is B's entry, not B's drained — no
ref matches, so A never advances. A ends after its first item and silently drops
the rest.

The fix must let A's advance check see A's configured `drained:` target before
B's empty-loop chaining rewrites it away. Note the existing comment in `step`
insisting `applyEachDrainAdvance` runs LAST so a `retry: otherwise:` landing on
a `drained:` target still obeys the advance rule — a reordering must not break
that, and both properties need a test that fails if either is lost.

Settled approach: carry the pre-chain target out of `qualifyLoopTarget` rather
than reordering `step`. `qualifyLoopTarget` already recurses on `ref.drained`
when a snapshotted list is empty; have it also return the target it was asked to
qualify before that chaining rewrote it. Thread that value through `applyRetry`
the same way `enteredEachRef` is already threaded, and have
`applyEachDrainAdvance` match `ref.drained` against both the resolved target and
that pre-chain target, advancing on either.

## Requirement C — each fix needs a scenario, and the suite must stay green

Requirements A and B are each a behaviour this repo has no test for. Per
`AGENTS.md`: a cucumber scenario per feature, composable `Given` steps, real
file content in scenario text.

Requirement A wants a workflow whose `entries.default` sits inside an `each:`
subtree, proving it fails to load with a named error. Requirement B wants a
two-loop-in-sequence scenario with an empty second list — the exact shape
`qualifyLoopTarget`'s own doc comment describes but nothing exercises.

Adding no new `npm test` task means no `turbo.json` edit; adding one means all
three of a `package.json` script, a `turbo.json` task with explicit `inputs`,
and the task name in the `test` list, or `tests/tooling/turbo.test.ts` fails.

## Tasks

### Reject an `each:`-subtree entry in `validateEntries`

Paths: `src/PatternMachine.ts` (`validateEntries` and its `checkEntry` helper).

- [ ] `validateEntries` rejects an `entries.default` state inside an `each:`
      subtree, via the exported `isInEachSubtree` predicate
- [ ] The same check fires for every `entries.manual` state, added once inside
      the shared `checkEntry` helper rather than duplicated per key
- [ ] The `entries.default` error reads exactly:
      `entries.default "<state>" is inside an each: reference — a process may not start inside a loop`
- [ ] The `entries.manual` error reads exactly:
      `entries.manual "<state>" is inside an each: reference — a process may not be entered inside a loop`
- [ ] Each message names the offending state, the rule, and the fix — it is the
      only diagnostic an author gets, because `validateReachability` is skipped
      whenever entries fail
- [ ] `manualEntryStates` and `enterableStates` are unchanged
- [ ] `initialStateOf` and `resolveState` are unchanged — the fallback is safe
      by consequence of the load rule, not by a new guard

### Unit-test both load errors

Paths: `src/PatternMachine.test.ts`.

- [ ] A test pins the exact `entries.default` error string for a definition
      whose default entry sits inside an `each:` subtree
- [ ] A test pins the exact `entries.manual` error string for a definition whose
      manual entry sits inside an `each:` subtree
- [ ] A test proves a definition whose entries all sit outside every `each:`
      subtree still validates clean
- [ ] `npm test` passes

### Let loop A's advance survive loop B's empty-list chaining

Paths: `src/PatternMachine.ts` (`qualifyLoopTarget`, `applyRetry`,
`applyEachDrainAdvance`, `step`).

- [ ] `qualifyLoopTarget` returns, alongside its qualified target and
      `enteredEachRef`, the target it was asked to qualify before empty-list
      chaining rewrote it
- [ ] `applyRetry` threads that pre-chain value through its recursion the same
      way it already threads `enteredEachRef`
- [ ] `applyEachDrainAdvance` advances when `ref.drained` matches either the
      resolved target or the threaded pre-chain target
- [ ] `applyEachDrainAdvance` still runs LAST in `step` — the call order is
      unchanged, and the comment explaining why it must run last is preserved
- [ ] `applyEachDrainAdvance`'s existing `continue` on a ref whose subtree
      `currentState` is not inside still falls through to the next candidate
      ref, so an unrelated ref sharing a `drained:` string never shadows the
      real one
- [ ] `npm test` passes

### Unit-test both loop properties, so losing either reds the suite

Paths: `src/PatternMachine.test.ts`.

- [ ] A test proves loop A with a non-empty snapshotted list advances to its
      next item when its `drained:` names loop B's reference and B's snapshotted
      list is empty
- [ ] A test proves a `retry: otherwise:` target that happens to be a `drained:`
      target still obeys the advance-or-end rule
- [ ] The first test fails if the pre-chain threading is removed; the second
      fails if `applyEachDrainAdvance` is moved earlier in `step`
- [ ] A test still covers an exhausted `drained:` standing verbatim — the last
      item does not advance past the end of the list

### Scenarios: refused entries and a two-loop sequence

Paths: `tests/integration/features/each-loop.feature`, plus a scenario beside
the existing config-error features.

- [ ] A scenario declares a workflow whose `entries.default` sits inside an
      `each:` subtree, with the YAML inline in the scenario text, and asserts
      `gtd` fails to load printing that exact error
- [ ] A second scenario does the same for `entries.manual`, asserting its own
      exact error
- [ ] Both load-failure scenarios live beside the existing config-error
      features, not in `each-loop.feature` — a load failure is not an `each:`
      behaviour
- [ ] A scenario in `each-loop.feature` runs two loops in sequence, loop A's
      `drained:` naming loop B's reference, with B's `glob:` matching nothing,
      and asserts loop A builds every one of its items
- [ ] Setup uses composable, generic `Given` steps with real file content and
      real YAML in the scenario text; step logic is inlined into step
      definitions
- [ ] No new `npm test` task is added, so `turbo.json` is untouched and
      `tests/tooling/turbo.test.ts` still passes
- [ ] `npm test` passes
