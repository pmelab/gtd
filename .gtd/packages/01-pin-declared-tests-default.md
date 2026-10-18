# 01 — pin `requireDeclaredTests` fix-turn default

## Requirement

1. `requireDeclaredTests` keeps its `turn = "fix"` default. The public
   two-argument call `requireDeclaredTests(pkg, since)` resolves to the fix
   turn. Review note overridden: no production change, not breaking.

## Tasks

### 1. Widen the test helper to reach the default

- [ ] `run`'s `turn` parameter accepts `"build" | "fix" | "default"`, still
      defaulting to `"build"`
- [ ] `"default"` calls `requireDeclaredTests(pkg, "c")` with exactly two
      arguments — never passes `undefined` (`run`'s own `= "build"` default
      would swallow it and test the wrong turn)
- [ ] existing `run(...)` callers unchanged

Paths: `src/workflows/feature/packages.test.ts`

### 2. Pin the default as the fix turn

- [ ] a call without `turn` accepts a modified `(unchanged)` test
- [ ] a call without `turn` accepts an added test
- [ ] the same two inputs are refused by the build turn, in the same test, so
      the assertion fails if the default ever flips
- [ ] `npm run test:workflows` green

Paths: `src/workflows/feature/packages.test.ts`

### 3. Leave production untouched (chore)

- [ ] `src/workflows/feature/packages.ts` signature, `= "fix"` default and JSDoc
      unchanged
- [ ] commit carries no `!` and no `BREAKING CHANGE:` footer

Paths: `src/workflows/feature/packages.ts`

## Tests

- unit: `src/workflows/feature/packages.test.ts`
