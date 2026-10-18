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

## ponytail-review: unreadable test-file strays skip the by-hand rest

What this change does: a `refactor-first` verdict whose strays are all test
files now skips the refactor and goes straight to `implement.*`; the refactor
review's closed collecting turn gets a prompt per round kind; the reviewer's
range wording is chosen by an explicit lap instead of inferred. Load assumed:
one person driving one process.

**Should fix**

1. **An unreadable test file is never shown to a human**
   (`src/workflows/feature/seam.ts` `seamBuild`)
   - **What this is:** `judgeDiffShape` returns `refactor-first` with a
     non-empty `unreadable` when it cannot read a stray's side; `seamBuild` then
     rests at `seam.by-hand` so a person looks at what the judge never saw.
   - **Problem:** the new early return `refactorStrays(shape).length === 0` runs
     before the `unreadable` check. A naive pass that adds a binary fixture
     under `tests/` (say `tests/fixtures/logo.png`, matched by `**/tests/**`)
     has only a test-file stray, it is unreadable, and the flow now goes
     straight on with no by-hand rest. `refactorFirst`/`plan` check `unreadable`
     first, and `docs/configuration.md` still says "a stray whose content cannot
     be read goes to a human instead", so the two entry points disagree.
   - **Fix:** swap the two checks in `seamBuild` — test `shape.unreadable`
     first, then the test-only early return — and add one `seam.test.ts` case:
     `refactor-first`, only stray `tests/x.bin` unreadable, expects
     `seam.by-hand`. The new test-only case in `seam.test.ts` does not cover
     this; it uses a readable stray.
   - **If we skip it:** content the judge never read reaches implement and the
     feature review with no one asked to look at it.

**Nice to have**

2. **Closed refactor rounds lost the footnote-anchoring rule**
   (`src/workflows/shared/text.ts` `buildReviewCollectingPrompt`, the
   `refactor.round !== "reply"` line)
   - **What this is:** `footnoteFoldIn` tells the turn to fold a footnote as a
     concern against its exact anchor, never flattened into a whole-file remark,
     and covers threads and replies.
   - **Problem:** dropping the whole block for closed rounds removes the reply
     rules (intended) and also the anchoring rule. An `edits` or `notes` round
     whose notes include a one-shot footnote now gives no guidance on how to
     fold it. The new test even asserts the one-shot rule is absent.
   - **Fix:** keep the anchoring bullet for closed rounds (split it out of
     `footnoteFoldIn` or add one line in `closedFold`), drop only the reply and
     thread bullets.
   - **If we skip it:** a footnote on one hunk can land in `.gtd/REFACTOR.md` as
     a vague whole-file concern.

3. **`openRound` exists only to shorten `finish`** (`src/workflow-kit/review.ts`
   `openRound`)
   - **What this is:** a new helper with six parameters, two of them closures
     (`collectWith`, `route`) that close over `finish`'s own locals.
   - **Problem:** it does no job of its own; it is `finish`'s old tail moved
     out, and every value it uses comes back in from `finish`. Its `route`
     callback only calls `routeNotes`. `settledRequest` also re-derives `noted`
     and the note list `finish`/`openRound` already compute.
   - **Fix:** inline `openRound` back into `finish`. If the correctness remedy
     (settled notes through `routeNotes`) lands, compute the note list once in
     `finish` for both branches.
   - **If we skip it:** two places parse the round's notes and must change
     together.

Verdict: fix 1 first. Lean: -12 lines possible. Not checked: the settled-branch
issues the correctness lens already filed above are not repeated here.

## test-audit: a kit test pins the settled round's silent loss of an edit note

`src/workflow-kit/review.test.ts` "without a dropped refusal an edit note signs
off unjudged" asserts that a settled round whose policy has no
`refusals.dropped` — the feature review's policy, since only the refactor's
`FeedbackTarget` sets `dropped` — signs off with an `edit` note never triaged or
folded. That is the lossy behaviour, made a contract: `finish` routes the
settled branch on whether a refusal string exists, not on what the round asked
for. A fix that sends the feature review's settled notes to triage (the
correctness remedy above) breaks this test for the right reason.

Remedy: delete this case, or invert it into the behaviour wanted for the feature
review (a settled edit note is triaged and folded), once that is decided.

## test-audit: settled-branch tests cannot see the capture's commit or the verdict split

- The `driveRound` mock captures (`edits: () => (captured.push("edits"), …)`)
  drop their arguments, so "a code hand-edit since reviewed names the path"
  passes whatever commit `captureFor` passes — the wrong-commit defect the
  correctness lens filed is invisible to it. Record the `round` argument and
  assert it is the range start (`reviewed`), not `head()` = `h2`.
- `docs/configuration.md` now says a settled round refuses on a note judged
  `nit` or `defer`. No kit test or scenario gives a settled round a `nit`,
  `defer` or `question` verdict; the settled cases use only `edit`/`praise`.
  This is the documented behaviour with no test, and the place the correctness
  finding on verdict routing would need its regression test.
- Both refusing settled scenarios in `refactor-review.feature` script the closed
  collecting turn to change nothing, and the kit's "a closed collecting turn
  that writes the feedback file turns the round into feedback" mocks the write
  itself. Nothing shows a real closed turn able to fold a pre-thread hand-edit
  from what the capture gives it.

## test-audit: guard reorder is pinned only below the access layer

`guardOf` now runs `requireNoTestFiles` before `requireWithin`. With test files
dropped from the strays, every live refactor turn's write access also excludes
them, so the access check refuses first — `refactor-package.feature` and
`refactor-review.feature` were changed to expect "outside its write access", not
"refactor-tests". The unit cases that still expect "refactor-tests"
(`refactor.test.ts` "refuses a build turn changing a test file even when it is a
stray", and the nit-fix and fix-check guard cases) pass only because the
in-memory `drive` harness enforces no write access. They pin an order no driver
can observe. Their names have also drifted: `src/a.test.ts` is no longer a stray
once `refactorStrays` filters it.

Remedy: keep one guard-level case with a comment saying it pins the guard under
access (like the existing line-544 note), rename it ("a test file the shape
listed"), and drop the reorder comment's claim that it matters live, or remove
`requireNoTestFiles` from the guard if access is now the sole owner.

## test-audit: test-only export and duplicate proof

- `isTestFile` is exported only for its direct test ("isTestFile is true for a
  test glob match only"). Production reaches it only through `refactorStrays`
  and `requireNoTestFiles`, which are already covered by the
  `refactorFirst`/`reviewedRefactor` cases on mixed strays. Unexport it and drop
  the direct test.
- The lap-wording contract has four owners: `text.test.ts` (owner, all three
  laps), `refactor.test.ts` "review lap wording", `feature.test.ts` flag matrix,
  and the `refactor-review.feature` scenario "the refactor review says the whole
  refactor…", which re-proves the flag=1 refactor + feedback threading
  `feature.test.ts` and `refactor.test.ts` already cover. Keep one threading
  proof per caller. The `feature.test.ts` case also drives through a catch-all
  `Proxy` actor that runs any `*closing` script and stops at `maxBeats: 80`, so
  a new or renamed state on that path is quietly handled, not reported.
- The new testkit step `step {string} rewrites {string} with:` does nothing when
  the file is absent. That is intended (it no-ops at the closed turn), but a
  scenario whose in-gate turn finds no review file passes without writing. Make
  it throw when the step it is scoped to runs as the in-gate turn and the file
  is missing, or name the conditional in the step text ("rewrites … if
  present").
