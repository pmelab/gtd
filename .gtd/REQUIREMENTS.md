# Requirements: review round 1 of 1d97e42 — declared-tests guard

Source: the human's footnote `[^turn-default]` in `.gtd/REVIEW.md` at
`e1ffa35e`, anchored on the `src/workflows/feature/packages.ts#91-134` hunk.

Baseline: `npm test` is green at `3c6d3736` (all three flag states pass), so no
repair concern leads.

## Concerns

### 1. `requireDeclaredTests` keeps its `turn = "fix"` default — TECHNICAL

**The human overrode the review note: `turn: DeclaredTestsTurn = "fix"` stays
(line 101 of `src/workflows/feature/packages.ts`).** Dropping it would break
two-argument TypeScript callers of a public `@pmelab/gtd/workflows` export.

- **No code change to the signature** — both in-repo callers (`packageItem`'s
  `declared` wrapper and the `run` helper in
  `src/workflows/feature/packages.test.ts`) already pass `turn` explicitly
- **No release impact** — no `!`, no `BREAKING CHANGE:` footer
- **Keep the JSDoc as is** — it already says a fix turn may edit a marked test,
  which matches the default; add no comment restating the signature

## Answered Questions

### Dropping the default changes a public export's type — ship it as breaking?

Keep the `= "fix"` default. The public signature stays `(pkg, since, turn?)`,
nothing breaks for external callers, and the review note is overridden.
