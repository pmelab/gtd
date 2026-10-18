# 03 — Feature feedback lap amends the existing change

Concern 5. Interfaces: `.gtd/ARCHITECTURE.md` (`implement`,
`implementBuildingPrompt` with `amend`).

## Requirements

### 5. Feature feedback lap amends the existing code

**After feature-review feedback, `implement.building` runs with the first-lap
prompt ("implement properly", "write the change fresh", "put it behind a new
release flag") while the earlier lap's code is still in the tree.**

- Feedback lap prompt: the change already exists from an earlier lap; amend it
  to meet the re-derived `.gtd/REQUIREMENTS.md`
- **Keep the release flag the first lap added; add none.** Tier `low` → "Add no
  release flag"
- First lap prompt unchanged, reference line included
- Applies to the `afterTail` feedback path too (shared loop)

## Tasks

### Task 1: `amend` variant of the building prompt

Paths: `src/workflows/shared/text.ts`, `src/workflows/feature/seam.ts`,
`src/workflows/feature/seam.test.ts`

- [ ] `implementBuildingPrompt(reference, tier?, amend?)` and
      `implement(reference, tier?, amend?)` per architecture
- [ ] Amend drops "implement properly", "write the change fresh" and the
      new-flag line; flag line per tier
- [ ] First lap renders exactly as today

### Task 2: Feedback lap passes `amend = true`

Paths: `src/workflows/feature/feature.ts` (wherever `featureFeedback` lives),
`src/workflows/feature/feature.test.ts`

- [ ] `featureFeedback` calls `implement(undefined, tier, true)`; `afterTail`
      inherits it

## Tests

- unit: `src/workflows/feature/seam.test.ts`
- unit: `src/workflows/feature/feature.test.ts`

Test cases:

- [ ] seam.test: `implement(undefined, undefined, true)` says the change exists
      and must be amended, keeps the earlier release flag, asks for no new one,
      lacks "implement them properly" and "write the change fresh"
- [ ] seam.test: `implement(…, "low", true)` says "Add no release flag"
- [ ] seam.test: first-lap `implement(reference)` unchanged, reference line
      included
- [ ] feature.test: on the naive pass the feedback lap's `implement.building`
      prompt is the amend variant, and so is the one `afterTail` drives
