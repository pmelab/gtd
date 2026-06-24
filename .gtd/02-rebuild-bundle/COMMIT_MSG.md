chore(gtd): rebuild bundle for human-review auto-advance

Regenerate the committed `scripts/gtd.js` from the package-01 src so the shipped
bundle carries the `human-review` `auto-advance` tag and the re-run-gtd prompt
(no terminal STOP), keeping the shipped CLI in sync with src.

NOTE: scope is `chore(gtd)` (not `fix(...)`) since this commit only refreshes the
built artifact and carries no behavior change beyond package 01.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
