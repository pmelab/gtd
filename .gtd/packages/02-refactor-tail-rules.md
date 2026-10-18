# 02 — Refactor review-tail fix prompts carry the refactor rules

Concern 4. Interfaces: `.gtd/ARCHITECTURE.md` (`refactorRules`, rules-taking
prompts and steps, `BuildTailOptions.rules`).

## Requirements

### 4. Refactor review-tail fix prompts name the strays and ban tests

**The fix turns inside `refactor.build.*` reuse the feature's prompts, which
never say the guard refuses any path outside the strays, any test file, or any
new flag read.** Turns burn their fix budget on landings the guard refuses.

- Covers every guarded turn of the refactor tail: suite fix, quality fix, risk
  fix, nit fix, escalation describe
- Each prompt lists the strays and states the no-test-file and no-new-flag-read
  rules (reuse `refactorRules`); any "add a test" line is dropped when rules are
  given
- **Feature tail prompts stay byte-identical**
- **Every public signature gains only an optional trailing `rules` — additive,
  not breaking**
- Out of scope: the refactor lap's own escalation describe turn (already uses
  `refactorFixPrompt`)

## Tasks

### Task 1: Prompts take optional `rules`

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] Export `refactorRules(strays, pattern)`
- [ ] `buildFixPrompt`, `buildFixQualityPrompt`, `buildReviewFixRisksPrompt`,
      `buildReviewFixNitsPrompt`, `healthDescribePrompt` take trailing `rules?`;
      appended when given, "add a test" dropped
- [ ] Without `rules` every prompt renders unchanged

### Task 2: Thread `rules` through steps, health, tail, buildTail

Paths: `src/workflows/shared/steps.ts`, `src/workflows/shared/health.ts`,
`src/workflows/shared/tail.ts`, `src/workflows/feature/steps.ts`,
`src/workflows/feature/review.ts`, `src/workflows/feature/refactor.ts`

- [ ] `fixCheck`, `fixQuality`, `describeEscalation`, `fixRisks`, `fixNits`,
      `escalation`, `fixQualityFindings`, `tail`, `HealthOptions.rules`,
      `BuildTailOptions.rules` per the architecture signatures
- [ ] `reviewedRefactor` passes `refactorRules(strays, pattern)` into
      `buildTail`; the feature tail passes none
- [ ] `npm run typecheck`/lint/boundaries green

## Tests

- unit: `src/workflows/shared/text.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- unit: `src/workflows/feature/review.test.ts`

Test cases:

- [ ] text.test: each of the five prompts unchanged without `rules`; with
      `rules` lists strays, no-test-file rule, no-new-flag-read rule; risks
      prompt drops its "add a test" line
- [ ] refactor.test: `reviewedRefactor`'s prompts at `refactor.build.fix`,
      `refactor.build.fix.quality.fixing`,
      `refactor.build.review.fix.risks.fixing`,
      `refactor.build.review.fix.nits.fixing`, `refactor.build.health.describe`
      each name every stray, ban test files, ban new flag reads
- [ ] review.test: `buildTail` without `rules` renders the feature tail's fix,
      quality-fix, risk-fix, nit-fix and describe prompts unchanged
