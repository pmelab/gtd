# 02 — Decompose prompt's one tests rule

## Requirements

### 3. Decompose prompt states one tests rule

- **One rule: list every test the package writes or changes; also list an
  existing test a criterion relies on, marked `(unchanged)`; list no other
  untouched test**
- Shows both forms: ``- unit: `<path>` (unchanged)`` and
  ``- e2e: `<path>` (unchanged)``
- Keeps "only decompose places the marker"; drops "never one it leaves
  untouched"
- `architectureDecomposePrompt` signature unchanged; only rendered wording
  changes

## Tasks

### Task 1 — Rewrite the tests rule in `architectureDecomposePrompt`

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] States the one tests rule (write-or-change, relied-on marked
      `(unchanged)`, no other untouched test)
- [ ] No longer says "never one it leaves untouched"
- [ ] Shows both ``- unit: `<path>` (unchanged)`` and
      ``- e2e: `<path>` (unchanged)``
- [ ] Keeps "only decompose places the marker"

## Tests

- unit: `src/workflows/shared/text.test.ts`
