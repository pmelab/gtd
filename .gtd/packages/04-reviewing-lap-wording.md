# 04 — Reviewing prompt states its range from an explicit lap

**Concern 6 alone.** Interfaces: `.gtd/ARCHITECTURE.md` (`ReviewLap`,
`buildReviewReviewingPrompt`, `reviewing`, `BuildTailOptions.lap`).

## Requirements

### 6. The caller names the lap; the prompt never infers it from `base`

- **`type ReviewLap = "first" | "feedback" | "refactor"`, a required argument of
  `buildReviewReviewingPrompt` and `reviewing`.**
- `"first"`: range covers everything since `base`.
- `"feedback"`: only what is new since the previous review.
- **`"refactor"`: the whole refactor since it started, on every round.**
- **`BuildTailOptions.lap` feeds it; absent means `"first"`.** Every `buildTail`
  caller passes `"feedback"` on a re-plan lap; `reviewedRefactor` passes
  `"refactor"`; `shared/tail.ts` hand-off review passes `"first"`.

## Tasks

### Task 1: Prompt and step

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`,
`src/workflows/shared/steps.ts`, `src/workflows/shared/tail.ts`

- [ ] Export `ReviewLap`;
      `buildReviewReviewingPrompt(base, lap, carry?,     removed?)` renders the
      lap's range wording only
- [ ] `reviewing(base, lap, carry?)`; `tail.ts` hand-off passes `"first"`
- [ ] Test: `"first"`, `"feedback"`, `"refactor"` each render their own range
      wording and none of the other two

### Task 2: `buildTail` callers

Paths: `src/workflows/feature/review.ts`, `src/workflows/feature/feature.ts`,
`src/workflows/feature/refactor.ts`, `src/workflows/feature/feature.test.ts`,
`src/workflows/feature/refactor.test.ts`

- [ ] `BuildTailOptions.lap?: ReviewLap` threaded to `reviewing`
- [ ] `planAndBuild`, `featureFeedback`, `naivePlanAndBuild`, `afterTail` pass
      `"feedback"` on a re-plan lap; `reviewedRefactor` passes `"refactor"`
- [ ] Test (feature.test.ts): first lap says everything since base; after
      feedback says only what is new — on both planned and naive-pass paths
- [ ] Test (refactor.test.ts): refactor review says the whole refactor since it
      started, on the first and the second round

### Task 3: E2E scenario

Paths: `src/workflows/feature/refactor-review.feature`

- [ ] Scenario (`@inmem`): second `refactor.build.review.reviewing` rest's
      content says the range is the whole refactor since it started; the
      feature's feedback-lap `build.review.reviewing` says only what is new
      since the previous review

## Tests

- unit: `src/workflows/shared/text.test.ts`
- unit: `src/workflows/feature/feature.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`
