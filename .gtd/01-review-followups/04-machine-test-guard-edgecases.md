# Test: add edge cases for the review-base / escalate guards (Machine.test.ts)

## Description

`src/Machine.test.ts` covers the happy paths of the RESOLVE guard ladder but
misses two edge cases:

1. **Empty/whitespace `refDiff` with `reviewBasePresent: true` → `verified`.**
   This is the regression guard for the `Events.ts` coherence fix. The machine's
   `humanReview` guard is
   `params.reviewBasePresent && (params.refDiff ?? "").trim().length > 0`, so a
   present review base whose diff is empty/whitespace must fall through to
   `verified`, NOT `human-review`.

2. **`escalate` winning over later leaves once the `fix(gtd):` counter hits the cap.**
   Add cases showing that when `verifyIterations >= MAX_VERIFY_ITERATIONS`,
   `escalate` is selected over leaves whose guards sit AFTER `capReached` in the
   RESOLVE ladder.

## IMPORTANT — actual guard ordering (read before writing)

In `src/Machine.ts` the RESOLVE transition array order is:

1. reviewModified → review-process
2. codeDirty → code-changes
3. hasPackages → execute
4. gtdDirExists → cleanup
5. todoFinalizedSimple → execute-simple
6. todoFinalized → decompose
7. **capReached → escalate**
8. todoNew → new-todo
9. todoModified → modified-todo
10. humanReview → human-review
11. (default) → verified

xstate picks the FIRST matching guard. Therefore `escalate` (position 7) wins
ONLY over leaves at positions 8-11: `new-todo`, `modified-todo`, `human-review`,
`verified`. It does NOT win over `cleanup` (position 4), `execute` (3),
`review-process` (1), `code-changes` (2), `execute-simple` (5), or `decompose`
(6) — those guards precede `capReached`.

NOTE: TODO.md suggested testing "escalate vs human-review and cleanup", but
`cleanup` precedes escalate in the ladder, so escalate does NOT win over cleanup.
Test escalate against leaves that actually sit after it. Use `human-review` and
`modified-todo` (and optionally `verified`) as the "escalate wins" targets. Do
NOT assert escalate-over-cleanup; that would be wrong. (The existing test already
covers escalate-over-verified at the cap; keep it.)

## What to build

Add `it(...)` cases to `src/Machine.test.ts` using the existing
`commit(isFixGtd)`, `resolveEvent(overrides)`, `basePayload`, and the imported
`MAX_VERIFY_ITERATIONS` / `resolve` helpers — do NOT add new helpers.

### Case 1 — empty refDiff regression guard

```ts
it("reviewBasePresent true but empty/whitespace refDiff → verified (not human-review)", () => {
  const { value, autoAdvance } = resolve([
    resolveEvent({ reviewBasePresent: true, refDiff: "   \n  ", baseRef: "abc123" }),
  ])
  expect(value).toBe("verified")
  expect(autoAdvance).toBe(false)
})
```

Also consider a sibling assertion where `refDiff` is `""` (empty string) →
`verified`.

### Case 2 — escalate wins over post-cap leaves

Build a stream of `MAX_VERIFY_ITERATIONS` `commit(true)` events, then a RESOLVE
whose payload would otherwise resolve to a later leaf, and assert `escalate`:

```ts
it("at cap, escalate wins over human-review", () => {
  const events: Array<GtdEvent> = []
  for (let i = 0; i < MAX_VERIFY_ITERATIONS; i++) events.push(commit(true))
  events.push(resolveEvent({
    reviewBasePresent: true,
    refDiff: "diff --git a/x b/x\n+hi\n",
    baseRef: "abc",
  }))
  expect(resolve(events).value).toBe("escalate")
})

it("at cap, escalate wins over modified-todo", () => {
  const events: Array<GtdEvent> = []
  for (let i = 0; i < MAX_VERIFY_ITERATIONS; i++) events.push(commit(true))
  events.push(resolveEvent({ todoDirty: "modified" }))
  expect(resolve(events).value).toBe("escalate")
})
```

`GtdEvent` is already imported at the top of the test file; reuse it.

## Files

- `/Users/pmelab/Code/gtd/gtd/src/Machine.test.ts` (add cases to existing describe blocks)
- `/Users/pmelab/Code/gtd/gtd/src/Machine.ts` (reference: RESOLVE guard ladder, `humanReview` + `capReached` guards)

## Constraints / edge cases

- Reuse existing `commit`, `resolveEvent`, `basePayload` helpers and the
  `MAX_VERIFY_ITERATIONS` import; do not duplicate them.
- Respect the real guard ordering above — do NOT add an
  "escalate over cleanup/execute" assertion (it would fail / encode wrong behavior).
- The empty-refDiff case must assert `verified`, matching the machine guard, even
  though `reviewBasePresent` is `true` (defends the Events.ts fix from regression).

## Acceptance criteria

- [ ] A case asserts `reviewBasePresent: true` + whitespace-only `refDiff` → `verified`, `autoAdvance` false.
- [ ] (Optional but recommended) a sibling case with `refDiff: ""` → `verified`.
- [ ] A case asserts that at the cap, `escalate` wins over `human-review`.
- [ ] A case asserts that at the cap, `escalate` wins over `modified-todo` (or another post-cap leaf, NOT cleanup/execute).
- [ ] No assertion claims escalate wins over cleanup/execute/review-process/code-changes/execute-simple/decompose.
- [ ] Tests reuse the existing helpers and `MAX_VERIFY_ITERATIONS` import.
- [ ] `npm test` (vitest) passes with the new cases.
