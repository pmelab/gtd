# Requirements: review round 1 of 1d97e42 — declared-tests guard

Source: the human's footnote `[^turn-default]` in `.gtd/REVIEW.md` at
`e1ffa35e`, anchored on the `src/workflows/feature/packages.ts#91-134` hunk.

## Concerns

### 1. `requireDeclaredTests` takes `turn` with no default — TECHNICAL

(critical: judge unsure)

**`requireDeclaredTests(pkg, since, turn)` still declares
`turn: DeclaredTestsTurn = "fix"`.** The requirement was a required `turn` with
no default.

- **Drop the `= "fix"` default** in `src/workflows/feature/packages.ts`; every
  caller must name `"build"` or `"fix"`
- Existing callers already pass it: `packageItem`'s `declared` wrapper and the
  `run` helper in `src/workflows/feature/packages.test.ts`. No behaviour change;
  the type checker is the gate (`npm run typecheck` or equivalent)
- Keep the JSDoc accurate after the change; add no comment restating the
  signature
