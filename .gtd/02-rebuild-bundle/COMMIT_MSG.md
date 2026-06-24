chore(gtd): rebuild bundle for review-diff !! harvesting

Regenerate the committed `scripts/gtd.js` from the package-01 src so the shipped
bundle harvests `!!` via the review-session diff (`grepBangAdded`) and ships the
read-only review-process prompt (no "strip from source" instruction).

NOTE: scope is `chore(gtd)` (not `fix(...)`) since this commit only refreshes the
built artifact and carries no behavior change beyond package 01.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
