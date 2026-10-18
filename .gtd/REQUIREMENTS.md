# Requirements: review round 1 of 1d97e42 — declared-tests guard

Source: the human's footnote `[^turn-default]` in `.gtd/REVIEW.md` at
`e1ffa35e`, anchored on the `src/workflows/feature/packages.ts#91-134` hunk.

Baseline: `npm test` is green at `3c6d3736` (all three flag states pass), so no
repair concern leads.

## Open Questions

### Dropping the default changes a public export's type — ship it as breaking?

`requireDeclaredTests` is exported from `@pmelab/gtd/workflows`, which
COMPATIBILITY.md puts under "Follows package SemVer". On `main` it is
`(pkg, since)`; a required third `turn` makes every two-argument TypeScript
caller a type error. Runtime is unchanged: a missing `turn` still behaves like
`"fix"`.

- [ ] Drop the default and mark the change breaking
  - squash title gets `!`, a commit carries a literal `BREAKING CHANGE:` footer
    ("pass `"build"` or `"fix"` as the third argument")
  - cuts a major release for one signature change
  - honours COMPATIBILITY.md exactly
- [ ] Drop the default, keep the export, no `!`
  - patch/minor release; external TypeScript callers break without notice
  - contradicts COMPATIBILITY.md's "each export's … type"
- [ ] Drop the default and stop exporting `requireDeclaredTests` /
      `DeclaredTestsTurn`
  - removes a public symbol — still breaking, still needs `!` plus footer
  - shrinks the public surface so later guard changes stop being breaking
- [x] Keep the `= "fix"` default
  - no release impact; overrides the review note
- [ ] _your answer_

## Concerns

### 1. `requireDeclaredTests` takes `turn` with no default — TECHNICAL

(critical: judge unsure)

**`requireDeclaredTests(pkg, since, turn)` still declares
`turn: DeclaredTestsTurn = "fix"` (line 101).** The requirement was a required
`turn` with no default.

- **Drop the `= "fix"` default** in `src/workflows/feature/packages.ts`; every
  caller must name `"build"` or `"fix"`
- **Only two callers exist, both already pass `turn`**: `packageItem`'s
  `declared` wrapper (`"build"` then `"fix"`) and the `run` helper in
  `src/workflows/feature/packages.test.ts`. Nothing in `claude/`, `docs/` or
  `README.md` names it. The type checker is the gate (`npm run typecheck` or
  equivalent), plus `npm run test:workflows`
- **Release labelling follows the open question above** — the export is public
  SemVer surface, so the squash title and footer depend on that answer
- Keep the JSDoc accurate after the change; add no comment restating the
  signature
