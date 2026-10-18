## correctness: settled-round capture points at a commit without the hand-edit

`src/workflow-kit/review.ts` `captureFor` (settled branch of `finish`) hands the
closed collecting turn `p.captures.edits(round)` / `editNotes(round, …)` with
`round = head()`. On this branch the round is _settled_ by definition:
everything after `collectedAt` is thread-only, so every hand-edit and every
change note was landed in an EARLIER commit (between `reviewed` and the reply
turn). `reviewEditsCapture` tells the agent "Any hand edits are in that commit's
other paths. Run: git show ${commit}" — that `git show` shows only the human's
last thread reply, never the hand-edit. The `edits` capture does not list paths
either, so a hand-edit-only settled round gives the agent nothing to fold; it
writes no `.gtd/REFACTOR.md`, and `refactorDroppedRefusal` fires, whose only way
out is `gtd abandon` — the retry re-runs the same misdirecting capture, so it
cannot recover.

Coverage: both new settled scenarios in `refactor-review.feature` ("a change
note left behind…", "a hand-edit made before the thread…") script the collecting
turn to write nothing and assert the refusal; no scenario has a settled round's
collecting turn succeed, so nothing would fail if the capture pointed at the
wrong commit.

Remedy: give the capture the range, not the tip — pass `reviewed` and render
`git diff ${reviewed} ${round}` (and list `req.paths` in the capture), then add
a scenario whose collecting turn folds the earlier hand-edit and the round goes
to feedback.

## correctness: settled branch treats nit and defer notes as edits, drops questions

`settledRequest` keeps notes judged `edit`, `nit` or `defer` and passes them all
as `req.notes` to `editNotes`, whose capture says "Fold only these edit notes"
and whose `triaged` prompt says "Fold each `edit` note the capture lists". The
main path (`routeNotes`) enforces a different invariant for the same verdicts:
`nit` → `fixNits` + `keepGreen` (no lap), `defer` → `p.defer` (written to TODO,
out of the round), `question` → `answerQuestions` + rest at the gate. On the
settled path:

- a `nit` / `defer` note is folded into `.gtd/REFACTOR.md` as a change and costs
  a whole refactor lap; a deferred note is never recorded as deferred
- if the collecting turn rightly folds nothing for a nit, `dropped` refuses with
  "only way out is `gtd abandon`" — a nit-only round becomes unrecoverable
- a `question` note is filtered out entirely; a question-only settled round
  signs off via `unfolded()` with the question never answered

No test covers a `nit`, `defer` or `question` verdict on the settled branch (the
kit tests in `review.test.ts` use only `edit` / `praise`).

Remedy: route the settled branch's notes through `routeNotes` (same `Round`
object `finish` already builds) instead of a parallel filter, so both write
paths share one verdict dispatch; keep `captureFor` only for the hand-edit case.
