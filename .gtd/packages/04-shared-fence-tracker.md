# 04 — `demoteHeadings` reuses `markFenced`

Concern 6. Interface: `.gtd/ARCHITECTURE.md` (`markFenced` in
`src/workflows/shared/fences.ts`).

## Requirements

### 6. `demoteHeadings` reuses `markFenced`

**`demoteHeadings` carries its own looser fence tracker; `markFenced` already
handles indent ≤3, fence length and closing rules.**

- Move `markFenced` verbatim to `src/workflows/shared/fences.ts`; **not**
  re-exported from `@pmelab/gtd/workflows`; boundary rules need no change
- `demoteHeadings` uses it: a fenced line is never a heading
- Today's tests keep passing; add the cases where the trackers differed

## Tasks

### Task 1: Move and reuse the tracker

Paths: `src/workflows/shared/fences.ts` (new), `src/workflows/feature/tier.ts`,
`src/workflows/feature/refactor.ts`

- [ ] `markFenced` moved verbatim; `readRiskTier`/`sectionLines` import it
- [ ] `demoteHeadings` drops its own tracker and uses `markFenced`
- [ ] `lint:boundaries` green; nothing new in the workflows public index

## Tests

- unit: `src/workflows/feature/refactor.test.ts`
- unit: `src/workflows/feature/tier.test.ts`

Test cases:

- [ ] refactor.test: through `reviewedRefactor`'s re-derived package, a
      collected heading inside a fence opened with four backticks, after an
      inner three-backtick line, stays fenced and undemoted
- [ ] refactor.test: a three-backtick line indented 4 spaces is not a fence; the
      heading after it is demoted
- [ ] tier.test: existing `readRiskTier` and `productionSignals` cases stay
      green
