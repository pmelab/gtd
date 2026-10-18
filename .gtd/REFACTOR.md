# Behaviour-neutral refactor

## Scope (read-only)

- `scripts/test-states.main.ts`
- `scripts/test-states.ts`

This list is fixed when the package is derived: editing it here widens or
narrows nothing.

## Rules

- The suite's outcome must not change
- Change only the paths above, and never a test file
- Introduce no flag read and add no second read of an existing one
  (`\bGTD_FLAG_\w+`)

## Reference

Reading material only, never applied:
`git show ce64624fb5d0e34c35b5a99874febc70383b8ea2 -- 'scripts/test-states.main.ts' 'scripts/test-states.ts'`
