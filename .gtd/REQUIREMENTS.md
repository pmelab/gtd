# Requirements: PR 390 round 3 correctness fixes

Source: the entry commit `780dc432` replaced `.gtd/TODO.md` with a seven-point
note ("PR 390 round 3, correctness only"). It also deleted the two
`## Deferred review notes` sections (see Answered Questions). All seven points
fix the refactor-first slice this branch adds; every concern is TECHNICAL, each
a direct directive from the note.

Every concern ships with its own test: a unit test beside the code it changes,
plus an `@inmem` scenario in `src/workflows/feature/refactor-review.feature`
where the behaviour is visible at a rest. Any changed user-visible behaviour is
reflected in `docs/configuration.md`'s refactor-review section.

## 1. Plan drops test-file strays; none left means land — TECHNICAL

**Today `plan` hands every stray to the refactor, test files included.** With a
narrowed `seamAllow`, a test file becomes a stray. The refactor may never change
a test file (`refactor-tests`), so a package scoped to it can never pass.

- **Drop every stray matching `testFileGlobs` before building the plan.** The
  same fixed list the `refactor-tests` guard uses — never `seamAllow`.
- **No stray left: treat the verdict as `land`.** No `refactor` scope, no
  `refactor.*` step, no refactor review; the feature builds from the naive
  pass's tip, and the feature review's base is the caller's base, not a
  post-refactor `head()`.
- Package scope list, write access (`strayAccess`), the scope guard and the
  collecting fence all use the filtered list.
- Ordered first: concerns 2–4 build on what the refactor scope holds.

Acceptance:

- `refactor-first` with strays `src/a.ts` and `src/a.test.ts` → the package
  lists only `src/a.ts`.
- `refactor-first` whose strays are all test files → the process goes straight
  to `implement.*`, no `refactor.*` step runs.

## 2. A settled refactor round with unfolded change notes refuses — TECHNICAL

**Today a refactor-review round can sign off with change requests silently
dropped.** When a thread sends the round through the in-gate collecting turn,
that turn folds nothing into `.gtd/REFACTOR.md`, and the human then lands only
thread replies or ticks, the round is `settled` and `unfolded()` signs off. The
round's change notes and code hand-edits are lost.

- **A settled round whose notes or hand-edits asked for a change, with no
  `.gtd/REFACTOR.md` written, refuses through `refusals.dropped`
  (`refactor-feedback`).** Same refusal text and `gtd abandon` way out as the
  existing dropped case.
- The refusal names each change note (parsed from the review since `reviewed`)
  and each hand-edited code path since `reviewed`.
- **Only where `refusals.dropped` is set.** The feature review keeps signing off
  on a settled round, as today.
- A settled round with only praise, answered questions or thread replies still
  signs off.

## 3. The closed refactor collecting turn folds hand-edits and unparsed notes too — TECHNICAL

**Today the closed variant (`open: false`) folds "each `edit` note the capture
lists, no other note, and every hand-edit".** On a hand-edit round and on a
notes round whose edit parses to no note, the capture lists no `edit` note, so
the human's notes on those rounds are never folded.

- **On a hand-edit round, fold every hand-edit and every note the human left
  that round.**
- **On an unparsed-notes round (`captures.notes`), fold each note that asks for
  a change.**
- On a triaged round, keep folding only the `edit` notes the capture lists.
- The refactor fence and the "must write `.gtd/REFACTOR.md`" rule are unchanged.

## 4. The closed variant drops `footnoteFoldIn` and the code thread reply rules — TECHNICAL

**Today the closed variant still carries `footnoteFoldIn` and
`codeThreadReplies()`.** Both tell the turn to reply in or edit a review that is
already closed, contradicting "do not recreate it or reply in it".

- **Render neither block in the `open: false` variant.**
- The open variant and the feature (non-refactor) collecting prompt keep both,
  unchanged.
- Pin it in `text.test.ts`: the closed variant contains neither block's text;
  the open variant contains both.

## 5. Demote headings caps at h6 — TECHNICAL

**Today `demoteHeadings` shifts every heading by the same amount, so a deep
heading in the collected feedback passes `######` and stops being a heading.** A
`#####` heading with shallowest `#` lands at `#######`.

- **Cap every demoted heading at `######`.**
- Fenced lines and non-heading lines stay untouched, as today.

Acceptance: feedback with `#` and `#####` headings → `###` and `######`.

## 6. Reviewing prompt states the base per lap — TECHNICAL

**Today `buildReviewReviewingPrompt` always says a feedback round's base "is the
previous review's boundary, so it covers only what's new".** That is false for
the refactor review: every round reviews the whole refactor since its entry.

- **Word the range by lap:** first round — everything since `base`; feature
  feedback round — only what is new since the previous review; refactor review
  round — the whole refactor since it started, every round.
- The caller says which lap it is; the prompt never guesses from the base.

## 7. Upgrade note covers 27.x — TECHNICAL

**Today the upgrade note says "a `GTD_FLAG_NAIVE_PASS` process from any 28.x
release".** The naive pass shipped in 27.5.0, so every affected process today
runs a 27.x release (27.5.0 through 27.9.0). 28.x does not exist yet.

- **Name 27.5.0 and later** in `docs/configuration.md`'s **Upgrading** list.
- Same fix in the PR body's `BREAKING CHANGE:` footer, which says "from 28.0.0".

## Answered Questions

### Are the two deleted `## Deferred review notes` sections folded in?

No: the human deleted both (note-3 `stdout` assertion, note-2 `history list`
scenario) in the same edit that scoped this round to "correctness only", so they
are dismissed, not work for this process.

### Does a dropped test-file stray still get its change built?

Yes: the feature's `implement.*` turn reads the whole naive-pass tip, test files
included, so dropping a stray from the refactor never drops it from the feature.
