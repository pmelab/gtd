# Architecture: review round 1 of 1d97e42 — declared-tests guard

**No production change.** The human overrode the review note: the `turn = "fix"`
default on `requireDeclaredTests` stays. The only work is a unit test that pins
the default, so the public two-argument call cannot silently change meaning.

## Interfaces

Unchanged — recorded because the default is now a pinned contract of the public
`@pmelab/gtd/workflows` export.

```ts
// src/workflows/feature/packages.ts
export const requireDeclaredTests = (
  pkg: string,
  since: string,
  turn: DeclaredTestsTurn = "fix",
): void
```

## Call Stacks

- `packageItem` `declared` wrapper → `requireDeclaredTests(pkg, from, kind)` —
  turn passed explicitly, default unused in-repo
- external `gtd.config.ts` → `requireDeclaredTests(pkg, since)` — two-argument
  call resolves to the fix turn

## E2E Scenarios

No e2e change. The signature and every refusal message stay as shipped; nothing
a user sees moves.

## Unit Tests

### requireDeclaredTests

- unit: src/workflows/feature/packages.test.ts — a call without `turn` behaves
  as the fix turn: it accepts a modified `(unchanged)` test and an added one,
  both of which the build turn refuses (covers 1. `requireDeclaredTests` keeps
  its `turn = "fix"` default)

### Chores

- chore: src/workflows/feature/packages.ts — leave the signature, the default
  and the JSDoc untouched; no `!`, no `BREAKING CHANGE:` footer (covers 1.
  `requireDeclaredTests` keeps its `turn = "fix"` default)

## Answered Questions

### Dropping the default changes a public export's type — ship it as breaking?

Keep the `= "fix"` default. The public signature stays `(pkg, since, turn?)`,
nothing breaks for external callers, and the review note is overridden.

### How does the test reach the default when the `run` helper always passes `turn`?

Widen `run`'s `turn` to `"build" | "fix" | "default"`; `"default"` calls
`requireDeclaredTests(pkg, "c")` with two arguments. Passing `undefined` does
not work: `run`'s own `= "build"` default would swallow it and test the wrong
turn.
