# Behaviour-neutral refactor

## Scope (read-only)

- `docs/configuration.md`
- `src/workflows/feature/feature.ts`
- `src/workflows/feature/refactor.ts`
- `src/workflows/feature/review.ts`
- `src/workflows/feature/seam.ts`
- `src/workflows/shared/text.ts`

This list is fixed when the package is derived: editing it here widens or
narrows nothing.

## Rules

- The suite's outcome must not change
- Change only the paths above, and never a test file
- Introduce no flag read and add no second read of an existing one
  (`\bGTD_FLAG_\w+`)

## Reference

Reading material only, never applied:
`git show a8c7122c15037e064caaa4da2178c2e93bfb7af2 -- 'docs/configuration.md' 'src/workflows/feature/feature.ts' 'src/workflows/feature/refactor.ts' 'src/workflows/feature/review.ts' 'src/workflows/feature/seam.ts' 'src/workflows/shared/text.ts'`
