chore(gtd): rebuild bundle for revert-based review teardown

Regenerate the committed `scripts/gtd.js` from the package-01 src so the shipped
bundle carries the mechanical revert-based review-process teardown, the
`reviewPresent` `codeDirty` gate, and the boolean `hasBangAdded` (no
`BangComment`/`bangComments`/`checkoutTracked`/`cleanUntracked`).

NOTE: scope is `chore(gtd)` (not `fix(...)`) since this commit only refreshes the
built artifact and carries no behavior change beyond package 01.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
