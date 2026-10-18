# 01 — Refactor drops test-file strays; demoted headings cap at `######`

**One package for concerns 1 and 5** — both centre on
`src/workflows/feature/refactor.ts`'s package derivation. Interfaces and call
stacks: `.gtd/ARCHITECTURE.md` (concern 1).

## Requirements

### 1. Test-file strays never reach the refactor

- **Drop every stray matching `testFileGlobs` before building the plan** — the
  same fixed list the `refactor-tests` guard uses, never `seamAllow`.
- **No stray left: treat the verdict as `land`.** No `refactor` scope, no
  `refactor.*` step, no refactor review; the feature builds from the naive
  pass's tip; the feature review's base is the caller's base, not a
  post-refactor `head()`.
- Package scope list, write access (`strayAccess`), the scope guard
  (`requireWithin`) and the collecting fence all use the filtered list.
- **Filter lives in one exported `refactorStrays`, applied in both `plan` and
  `seamBuild`** — `seamBuild` checks it before the unreadable branch.
- A dropped test-file stray is still built by `implement.*` (it reads the whole
  naive-pass tip).

Acceptance: strays `src/a.ts` + `src/a.test.ts` → package lists only `src/a.ts`.
All strays test files → straight to `implement.*`, no `refactor.*` step.

### 5. Demoted headings cap at `######`

- **Shift headings so the shallowest lands at `###`; cap every one at
  `######`.**
- Fenced lines and non-heading lines untouched.

Acceptance: feedback with `#` and `#####` headings → `###` and `######`.

## Tasks

### Task 1: `isTestFile` / `refactorStrays`

Paths: `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`

- [ ] `export const isTestFile: (path: string) => boolean` — true for a path any
      `testFileGlobs` entry matches; `requireNoTestFiles` uses it
- [ ] `export const refactorStrays: (shape: DiffShapeResult) => readonly string[]`
      — `shape.strays` minus every test file
- [ ] Both exported through `src/workflows/feature/index.ts` if a test outside
      the module needs them (seam.ts imports within the boundary directly)
- [ ] Test: `refactorStrays` drops `src/a.test.ts`, keeps `src/a.ts`, ignores a
      narrowed `seamAllow`
- [ ] Test: `requireNoTestFiles` refuses exactly what it refused before, through
      `isTestFile`

### Task 2: `plan` / `refactorFirst` / `reviewedRefactor` read the filtered list

Paths: `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`

- [ ] `plan` builds package scope list from `refactorStrays(shape)`;
      `strayAccess`, `guardOf`'s `requireWithin`, `fixAccess` and the collecting
      fence all take the filtered list
- [ ] `refactorFirst` / `reviewedRefactor` resolve `false`, run no step and open
      no `refactor` scope when `refactorStrays(shape)` is empty
- [ ] Test: strays `src/a.ts` + `src/a.test.ts` → package scope lists only
      `src/a.ts`; scope write access is `src/a.ts` + `.gtd/**`; collecting
      prompt's fence names only `src/a.ts`
- [ ] Test: all-test strays resolve `false`, no step run, no `refactor` scope

### Task 3: `seamBuild` skips an all-test refactor

Paths: `src/workflows/feature/seam.ts`, `src/workflows/feature/seam.test.ts`

- [ ] `refactor-first` shape with empty `refactorStrays` resolves
      `{ reference, base }` (the caller's base), enters no `refactor` slice,
      runs no `seam.by-hand`; checked before the unreadable branch
- [ ] Test: `refactor-first` with only test-file strays →
      `{ reference, base:     caller's base }`, no slice, no `seam.by-hand`

### Task 4: `demoteHeadings` caps at `######`

Paths: `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`

- [ ] Shallowest heading lands at `###`; every heading capped at `######`;
      fenced and non-heading lines untouched
- [ ] Test: collected feedback with `#` and `#####` headings derives `###` and
      `######`; a fenced heading-like line and prose stay untouched

### Task 5: E2E scenarios

Paths: `src/workflows/feature/refactor-review.feature`

- [ ] Scenario: narrowed `seamAllow`, `refactor-first` strays `src/calc.ts` and
      `src/calc.test.ts` → derived `.gtd/REFACTOR.md` scope lists only
      `src/calc.ts`
- [ ] Scenario: `refactor-first` whose strays are all test files rests next at
      `implement.building`, no `refactor.*` step in the history, feature
      review's base is the caller's base
- [ ] Scenario: collected `.gtd/REFACTOR.md` with `#` and `#####` headings
      re-derives a package holding `###` and `######` under `## Review feedback`
- [ ] All tagged `@inmem`; composable Given steps showing file content

### Task 6: Docs

Paths: `docs/configuration.md`

- [ ] Refactor-review section: test-file strays are dropped; an all-test
      `refactor-first` goes straight to `implement.*`
- [ ] No `src/*.ts` module or internal function named in the prose

## Tests

- unit: `src/workflows/feature/refactor.test.ts`
- unit: `src/workflows/feature/seam.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`
