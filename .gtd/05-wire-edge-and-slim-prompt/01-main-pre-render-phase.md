# Wire the review-process pre-render phase in `src/main.ts`

Add a `review-process` pre-render phase parallel to the existing
`TEST_GATED_LEAVES` block: when the resolved leaf is `review-process`, run the
edge write op and build the prompt with the new override.

## What to do (`src/main.ts`)

- After `const result = yield* detect()` and BEFORE the `TEST_GATED_LEAVES`
  block (mirroring its structure), add:
  ```ts
  if (result.value === "review-process") {
    const git = yield* GitService
    const base = result.context.baseRef
    // baseRef is always present for a review-process leaf (REVIEW.md parsed it);
    // fail clearly if somehow missing.
    if (base === undefined) {
      yield* Effect.fail(new Error("review-process: missing review base ref"))
    }
    const { diff, recordSha } = yield* git.recordAndRevertReview(base!)
    const prompt = buildPrompt(
      result,
      { kind: "review-process", reviewDiff: diff, recordSha },
      config.resolveModel,
    )
    yield* Effect.sync(() => process.stdout.write(prompt))
    return
  }
  ```
- `GitService` is already in scope (`GitService.Live` is provided at the bottom);
  `config` is already resolved above.
- KEEP `TEST_GATED_LEAVES` exactly `new Set(["human-review", "execute"])` — do
  NOT add `review-process` to it (the verbatim record commit must preserve the
  reviewer's tree even if broken).
- The existing `catchAll` at the bottom already writes `error.message` to stderr
  and `process.exit(1)` — so the `recordAndRevertReview` revert-conflict
  `Effect.fail` surfaces as exit 1 with no prompt emitted. No new error handling
  needed.

## Acceptance criteria

- [ ] `main.ts` runs `git.recordAndRevertReview(context.baseRef)` for the
      `review-process` leaf and injects the returned diff + recordSha via the
      `review-process` PromptOverride before `buildPrompt`.
- [ ] `TEST_GATED_LEAVES` unchanged (`review-process` stays OUT of it).
- [ ] Revert conflict → exit 1 via the existing `catchAll` (no prompt emitted).
- [ ] `npm run test` green.

## Files

- `src/main.ts`

## Constraints / edge cases

- DEPENDS ON package 04 (`recordAndRevertReview` op + `review-process`
  PromptOverride kind). Ordered after 04.
- File-disjoint from the prompt-slim task (task 02) in this package.
- `review-process` keeps `auto-advance`; the loop driver must NOT assume it left
  a dirty tree (the edge already committed/closed). Do not commit anything in
  `main.ts` beyond what `recordAndRevertReview` does.
- No vitest unit test covers `main.ts` directly; correctness is exercised by the
  e2e features in package 06. Ensure the build/typecheck passes.
