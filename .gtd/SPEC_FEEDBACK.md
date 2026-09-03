# Spec feedback — 04 Positioned findings and links

Every task checkbox in the package spec is implemented and verified:
`gtd check qa` on a misordered `## Answered Questions` prints
`NOTES.md:12:1: …`, an absent file still exits 0, only the missing-base finding
stays positionless, every other built-in finding carries a `line` plus a column,
the outline ends at real node boundaries, `documentLinks` is declared on
`review` only, and `format:check`, `typecheck`, `lint`, `lint:sh`, `deadcode`,
unit, e2e-inmem and e2e-live are all green. One gap remains.

## `docs/setup.md`'s editor-integration list omits hunk document links

`docs/setup.md` ("## Editor integration", lines 25-45) is the exhaustive
user-facing enumeration of what `gtd lsp` provides — outline, go-to-definition
into a hunk's target file, qa option actions, "add a footnote", footnote
jump-both-ways, live diagnostics, `gtd.openSteeringFile`. This package added a
new user-visible capability to that same server (`documentLinkProvider`: a
`./path#42` hunk pointer is a clickable link), and `README.md` was updated to
say so, but that list was not. A user configuring their editor from
`docs/setup.md` reads a capability list that is now incomplete.

Add one bullet naming the hunk-pointer document link (and that it lands at the
pointer's `#line`), alongside the existing go-to-definition bullet.
