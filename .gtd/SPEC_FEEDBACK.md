# Spec feedback — 03-refusals-and-durability

Everything else in the package checks out: Tasks 1, 2, 4, 5, 6, 7, 8, 9 and 10
are implemented, and `typecheck`, `lint`, `format:check`, `deadcode`, the unit
project (2065 passed), the storybook project (105 passed) and the `@live`
`ui-lifecycle.feature` (including the new reload scenario) are all green here.
One task is not met.

## Task 3 — "Saved" is announced for a write that was REFUSED

`src/web/Refusal.tsx#trackSave` settles `saveStatus` to `"saved"` in a
`.finally`, "regardless of outcome". Its own doc comment justifies that by
saying a rejection gets its own banner text instead — but `dismiss` clears only
`refusal`, never `saveStatus`, so the justification does not hold once the human
dismisses.

Reproduction, entirely within the shipped code:

1. Tap an option in `Plan` (or a hunk tick in `Review`). `onCommitAnswerTracked`
   → `trackSave` sets `saveStatus: "saving"`.
2. The `setValue` mutation rejects with `stale-token`. `trackSave`'s `.finally`
   runs FIRST (the caller's `.catch` is attached to the promise `trackSave`
   returns), setting `saveStatus: "saved"`; then `showRefusal` sets `refusal`.
3. `RefusalBanner` prefers `refusal`, so the named refusal sentence shows.
   Correct so far.
4. The human taps **Dismiss** within `SAVED_LINGER_MS` (1500ms) — a realistic
   phone interaction, and the only control the banner offers. `refusal` becomes
   `undefined`, `saveStatus` is still `"saved"`, so the SAME
   `role="status" aria-live="polite"` region now announces **"Saved"** for the
   write that was just refused and reverted.

That is the exact misreport Task 3's bullet exists to prevent: "so a blur that
is invisible on touch still reports whether the write landed." Here it reports
that it landed when it did not.

Fix direction (name it, don't guess): `saveStatus` must distinguish settle-ok
from settle-rejected — e.g. `trackSave` resolves to `"saved"` only on success
and to `"idle"` (or a distinct failed state) on rejection, and/or `dismiss`
clears `saveStatus` alongside `refusal`.

Add a story that covers it: reject a `setValue` with `stale-token`, assert the
named sentence, click `refusal-dismiss`, and assert the live region does NOT
then read "Saved". No story today drives the dismiss control at all —
`ARejectedStaleTokenWriteShowsTheNamedReasonOnScreen` asserts the message and
stops.
