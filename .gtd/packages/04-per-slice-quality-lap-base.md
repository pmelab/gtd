# 04 — Per-slice quality-lap base

## Requirement

**Concern 5.** Each slice's quality lap reviews **from that slice's base**, not
the process start: the refactor from its entry commit, the naive feature slice
from the refactor's sign-off commit (`seam.base`) on every lap, including after
a feedback lap. Outside a naive slice (`planAndBuild`, `afterTail`, hand-off
tails) the base stays `start()`. **The spec-challenge brief still looks up
planning documents from the process start** — `design.triage` lands before the
slice base.

See `.gtd/ARCHITECTURE.md` — `BuildTailOptions.lensBase`, `tail`,
`buildQualityReviewingPrompt`, call stack 5.

## Tasks

### 1. Prompt takes `base`

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] `buildQualityReviewingPrompt(lens, brief?, base?)` reviews from `base`,
      default `start()`; names the process start beside `base`
- [ ] `specChallengeBrief` lookup still from the process start
- [ ] Unit test pins all three

### 2. Thread through `tail` / `qualityLap` / `reviewQuality`

Paths: `src/workflows/shared/tail.ts`, `src/workflows/shared/steps.ts`,
`src/workflows/shared/tail.test.ts`

- [ ] `tail(…, lensBase?)`, `qualityLap(guard, lenses, base?)`,
      `reviewQuality(lens, base?)` per the interface
- [ ] Unit: `lensBase` reaches every lens turn's prompt; absent, the prompt
      names `start()`

### 3. `BuildTailOptions.lensBase` and callers

Paths: `src/workflows/feature/review.ts`,
`src/workflows/feature/review.test.ts`, `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`, `src/workflows/feature/feature.ts`

- [ ] `lensBase?` on `BuildTailOptions` reaches every quality-lens prompt;
      absent, `start()`
- [ ] `reviewedRefactor` passes `lensBase: entry`
- [ ] `naivePlanAndBuild` passes `lensBase: seam.base` to its first tail and to
      `featureFeedback(outcome, seam.base)`; every feedback lap keeps
      `lensBase: seam.base` while its review base is `outcome.base`
- [ ] `planAndBuild`, `afterTail`, `handOffTail` pass none
- [ ] Unit: refactor's lens prompt names the entry commit on the first lap and
      after a feedback lap

### 4. Scenario

Paths: `src/workflows/feature/refactor-review.feature`

- [ ] On `refactor-first`, the refactor's lens prompt names the refactor's entry
      commit; the feature's lens prompt names the refactor's sign-off commit,
      before and after a feature feedback lap

### 5. Docs

Paths: `docs/configuration.md`

- [ ] Naive-pass section says each slice's quality lap reviews from that slice's
      base

## Tests

- unit: `src/workflows/shared/text.test.ts`
- unit: `src/workflows/shared/tail.test.ts`
- unit: `src/workflows/feature/review.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`
