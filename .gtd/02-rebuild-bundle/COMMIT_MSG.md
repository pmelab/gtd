chore(gtd): rebuild bundle for Gtd-Test-Fix trailer counting

Regenerate the committed `scripts/gtd.js` from the updated src so the shipped
bundle counts the `Gtd-Test-Fix:` trailer (matching package 01).

NOTE: scope is `chore(gtd)` (NOT `fix(gtd)`) so this commit does not advance the
old subject-based escalate counter in any mid-flight loop running the prior
bundle.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
