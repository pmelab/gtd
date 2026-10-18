# 05 — One shared collecting prompt

## Requirement

**Concern 6.** Feature and refactor reviews collect through one prompt,
`buildReviewCollectingPrompt(capture, refactor?)`;
`refactorReviewCollectingPrompt` is deleted. **Without `refactor` the text is
identical to today's.** With `refactor` it targets `.gtd/REFACTOR.md`, lists the
strays and forbids any other path, a test file, a new or added flag read, or a
behaviour change; a concern breaking it is not folded; **no "say in the reply"
wording** — the package 01 refusal carries the `gtd abandon` advice. Both
variants carry answered questions into the target's `## Answered Questions`, and
the re-derived refactor package nests them as `### Answered Questions` under
`## Review feedback`.

See `.gtd/ARCHITECTURE.md` — `buildReviewCollectingPrompt`, `reviewedRefactor`,
call stack 6.

## Tasks

### 1. Shared prompt

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] `buildReviewCollectingPrompt(capture, refactor?: { strays })` per the
      interface
- [ ] Unit: without `refactor`, text equals today's feature prompt verbatim
- [ ] Unit: with `refactor`, targets `.gtd/REFACTOR.md`, lists every stray,
      forbids test files, flag reads and behaviour changes, carries answered
      questions to `## Answered Questions`, contains no "say in the reply"
      wording
- [ ] `refactorReviewCollectingPrompt` deleted; no remaining reference

### 2. Refactor collecting and heading demotion

Paths: `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`

- [ ] `refactorCollecting(capture, strays)` calls
      `buildReviewCollectingPrompt(capture, { strays })`
- [ ] The re-derived package demotes every heading of the collected text one
      level, nested under `## Review feedback`
- [ ] Unit: collecting uses the shared prompt with the refactor block
- [ ] Unit: collected `## Answered Questions` nests as `### Answered Questions`
      under `## Review feedback`

### 3. Scenario

Paths: `src/workflows/feature/refactor-review.feature`

- [ ] A question answered at the refactor review, followed by an edit note,
      reaches the re-derived `.gtd/REFACTOR.md` under `## Review feedback` as
      `### Answered Questions`

## Tests

- unit: `src/workflows/shared/text.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`
