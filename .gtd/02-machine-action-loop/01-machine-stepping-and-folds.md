# Machine: long-lived actor, stepping handle, no-agent + side-effect folds

Turn the pure fold into a **stepping machine** that drives the no-agent action
loop entirely in machine logic (Resolved q1/q2/q7). This is the hardest
green-on-its-own change: `ResolveResult` gains `edgeAction?`, no-agent leaves
lose `type:"final"` and loop back to `replaying`, and the test-gate /
review-pre-render branching moves out of `selectPrompt` (the edge) into the
machine's event folds. ALL of these production changes plus the `Machine.test.ts`
updates land in THIS task so vitest stays green.

## Files (this task)

- `src/Machine.ts`
- `src/Machine.test.ts`

> File-disjoint from sibling task `02-state-handle-and-prompt-select.md`, which
> owns `src/State.ts` + `src/State.test.ts`. Do not touch those here.

## Production changes (`src/Machine.ts`)

### 1. New constant + context fields

- Add `export const MAX_NO_AGENT_HOPS = 8` beside `MAX_VERIFY_ITERATIONS`.
  Orthogonal to verify iterations — separate constant, separate context field,
  never conflated.
- Extend `GtdContext` with:
  - `noAgentHops: number` (init `0`)
  - `lastAdvancedLeaf: LeafState | null` (init `null`)
  - `testOutput?: string` (captured red-test output for the `fix-tests` render)
  - `reviewDiff?: string`, `recordSha?: string` (REVIEW_RECORDED override data)
- Add these to `initialContext`.

### 2. New events

Extend `GtdEvent`:

```ts
| { type: "TEST_RESULT"; exitCode: number; output: string }
| { type: "REVIEW_RECORDED"; diff: string; recordSha: string }
```

(`COMMIT` and `RESOLVE` stay.)

### 3. `edgeAction` on the snapshot + `ResolveResult`

- Each action leaf must expose its `EdgeAction`. Model it with an `output` or a
  context field — simplest: a `context.edgeAction?: EdgeAction | undefined`
  assigned when entering an action leaf, cleared otherwise. Export it via
  `ResolveResult` (see below).
- Extend `ResolveResult` (still exported from this module) with
  `readonly edgeAction?: EdgeAction`. Present iff the settled leaf is an action
  leaf AND not stuck/capped.

### 4. No-agent leaves emit an action and loop back

Convert the three no-agent leaves so they are no longer `type:"final"`:

- `cleanup` → on entry set `edgeAction = { kind: "removeGtdDir" }`.
- `close-review` → `{ kind: "closeReview", base: context.baseRef! }`.
- `code-changes` → `{ kind: "commitPending" }`.

Each must accept the NEXT `RESOLVE` event (re-gathered facts) and transition back
to `replaying` (then re-evaluate the guard chain). On that re-entry, run a
`foldAdvance` action that:

- increments `context.noAgentHops`,
- records `lastAdvancedLeaf = <the leaf just left>`,
mirroring `foldCommit` (`Machine.ts:149-154`).

### 5. Cap + stuck guards → escalate

Add guards, checked when a no-agent leaf would be re-entered:

- `noAgentCapReached`: `context.noAgentHops >= MAX_NO_AGENT_HOPS`.
- `stuck`: the leaf the chain is about to settle on === `context.lastAdvancedLeaf`
  (no progress between two consecutive no-agent hops).

Either guard routes to `escalate` (the deterministic analogue of `capReached`,
`Machine.ts:130`). Place them so they win over re-emitting the same action.

### 6. Test gate folded into the machine (gated to `execute` ONLY)

- When the guard chain would settle on `execute`, FIRST route to a gate state
  that emits `edgeAction = { kind: "runTestGate" }` (do NOT settle on `execute`
  yet).
- That state accepts `TEST_RESULT` and folds it exactly as the old
  `selectPrompt` did:
  - `exitCode === 0` → proceed to `execute` (clear `edgeAction`).
  - `exitCode !== 0` AND `verifyIterations < maxVerifyIterations` → settle on
    `fix-tests`, assigning `context.testOutput = event.output`.
  - `exitCode !== 0` AND `verifyIterations >= maxVerifyIterations` → `escalate`.
- `human-review` is NO LONGER gated — it must settle directly with no
  `runTestGate`. (Behavior change per A4/Resolved q5.)
- Add `fix-tests` to `LeafState` (it is currently only a `PromptOverride` kind).
  Its leaf carries `context.testOutput` so `buildPrompt` can inject it.

### 7. Review pre-render folded into the machine

- The `review-process` leaf first emits
  `edgeAction = { kind: "reviewPreRender", base: context.baseRef! }`.
- It accepts `REVIEW_RECORDED` and settles on `review-process` with
  `context.reviewDiff = event.diff`, `context.recordSha = event.recordSha`, and
  `edgeAction` cleared, so `buildPrompt` renders the synthesis prompt.

### 8. Keep `resolve(events)` as a wrapper

- Add the stepping primitives used by `State.ts`:
  - `export const start = (events) => handle` that creates ONE long-lived actor,
    sends `events`, and returns a handle whose `current` is the first
    `ResolveResult & { edgeAction? }` and whose
    `advance(events) => ResolveResult & { edgeAction? }` sends more events to the
    SAME actor and returns the new snapshot projection.
  - Keep `resolve(events)` as a thin wrapper: `start(events).current` (drop the
    `edgeAction`/keep it — existing callers read `value`/`context`/`autoAdvance`
    only, so wrapper compatibility is preserved).
- The projection helper (snapshot → `ResolveResult`) reads `value`, `context`,
  `hasTag("auto-advance")`, and `context.edgeAction`.

## Acceptance criteria

- [ ] `MAX_NO_AGENT_HOPS = 8` exported; `noAgentHops` / `lastAdvancedLeaf` /
      `testOutput` / `reviewDiff` / `recordSha` on `GtdContext`.
- [ ] `GtdEvent` includes `TEST_RESULT` and `REVIEW_RECORDED`; `LeafState`
      includes `fix-tests`.
- [ ] `ResolveResult` has `edgeAction?: EdgeAction`.
- [ ] `cleanup` → `removeGtdDir`, `close-review` → `closeReview{base}`,
      `code-changes` → `commitPending`; none is `type:"final"`; each loops back
      to `replaying` on the next `RESOLVE` and runs `foldAdvance`.
- [ ] Settling on `execute` first emits `runTestGate`; the `TEST_RESULT` fold
      reproduces green→execute / red<cap→fix-tests(+testOutput) /
      red≥cap→escalate.
- [ ] `human-review` settles WITHOUT emitting `runTestGate`.
- [ ] `review-process` emits `reviewPreRender{base}`, then on `REVIEW_RECORDED`
      settles carrying `reviewDiff`/`recordSha`.
- [ ] `noAgentCapReached` / `stuck` route to `escalate`.
- [ ] `resolve(events)` still returns `{ value, context, autoAdvance }` (wrapper
      over `start`); `start(events).current` and `handle.advance(events)` exist.
- [ ] `npm run test` green; `npm run typecheck` passes.

## Tests this task MUST add/update (`src/Machine.test.ts`)

- Keep every existing leaf-routing assertion working. Note: tests that asserted
  `resolve(... hasPackages ...).value === "execute"` will now see an
  intermediate `runTestGate` edge action — adapt them to drive the gate via the
  stepping handle (send `TEST_RESULT { exitCode: 0 }`) OR assert the emitted
  `edgeAction.kind === "runTestGate"` first. Update the existing
  `hasPackages → execute` cases accordingly.
- New cases driving the live actor through the loop:
  - cleanup/close-review/code-changes each expose the right `edgeAction`; a
    following `RESOLVE` that clears the condition advances to the next leaf and
    bumps `noAgentHops`.
  - `runTestGate` fold: green→execute, red<cap→fix-tests (with `testOutput`),
    red≥cap→escalate.
  - `reviewPreRender` then `REVIEW_RECORDED` → review-process with
    `reviewDiff`/`recordSha` on context.
  - `noAgentHops >= MAX_NO_AGENT_HOPS` → escalate; `stuck` (same leaf twice in a
    row with no progress) → escalate.
  - `human-review` settles with NO `edgeAction` (no `runTestGate`).
- Move the green/fix/escalate branching coverage that lived in `State.test.ts`'s
  `selectPrompt` describe block INTO this file as `TEST_RESULT` folds (the sibling
  task deletes the `selectPrompt` describe block).

## Constraints / edge cases

- `Machine.ts` stays pure: no IO, no Effect, no git. Results come back ONLY as
  `TEST_RESULT` / `REVIEW_RECORDED` events.
- `noAgentHops` cap is independent of `verifyIterations`; never conflate them.
- Backward-compat: keep all existing `LeafState` ids recognized.
