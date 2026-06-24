feat(gtd): add EdgeAction type and no-agent GitService ops

Introduce the typed `EdgeAction` union (removeGtdDir, closeReview,
commitPending, runTestGate, reviewPreRender) and the three fire-and-re-gather
git operations the no-agent leaves will use. Extract `closeReview` from the tail
of `recordAndRevertReview` so both sites share one implementation. Nothing is
wired into the machine or main.ts yet; these are pure additions covered by new
Git.test.ts cases, leaving `npm run test` green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
