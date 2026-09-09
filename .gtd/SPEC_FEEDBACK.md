# Spec feedback — 03 — Every refusal reaches the human, and nothing typed is silently lost

Tasks 1–4 and 7–10 check out. Two defects, one root cause, both defeating the
package's own headline promise ("nothing typed is silently lost") on the exact
refusal path Requirement A exists to surface.

## 1. A refused free-text write poisons its own retry — `src/web/screens/Question.tsx`

`commitFreeText` sets `lastCommittedFreeTextRef.current = freeText` BEFORE the
write is issued (line ~"lastCommittedFreeTextRef.current = freeText"), and
`commitAnchor`'s rejection handler reverts only the `selected`/`freeText` STATE
fields — never that ref. After a refusal the ref holds text that was never
written.

Reproduction: free-text slot empty. Type `hello`, blur. `setValue` rejects with
`stale-token`. The banner shows, the revert restores `freeText: ""` — and
`lastCommittedFreeTextRef.current` stays `"hello"`. The human retypes `hello`
and blurs. Task 6's changed-since-last-commit guard compares `"hello"` to
`"hello"`, returns early, and NO write is issued. Textarea shows `hello`, disk
holds nothing, no banner, no way to tell. That is the silent divergence Task 6
was written to eliminate, just moved one refusal downstream.

Fix direction: roll the ref back to the pre-write value inside the rejection
handler, gated by the same `freeTextSeq` the field revert already uses, so a
stale rejection cannot roll back a newer landed write.

No story covers retry-after-refusal;
`ARejectedStaleTokenWriteShowsTheNamedReasonOnScreen` stops at the banner. Task
1's and Task 6's coverage bullets both need the retry leg added.

## 2. `NoteSheet` autosave gives up permanently after one refused write — `src/web/NoteSheet.tsx`

Same shape, worse outcome: `runAutoSave` sets
`lastAutoSavedRef.current = current` before calling `onAutoSave`, and the
`.finally` never distinguishes resolve from reject. `Plan.tsx`/`Review.tsx`
revert their optimistic note override on refusal, but `NoteSheet`'s own `text`
state is local and is NOT reverted — so after one refused autosave, `text` and
`lastAutoSavedRef` are equal and every later debounce, blur and UNMOUNT commit
returns early.

Reproduction: open a note sheet, type `needs work`, wait 800ms, the write is
refused (stale token). Keep typing nothing further, lock the screen. Unmount
fires `runAutoSave`, which returns early because
`current === lastAutoSavedRef.current`. The note is gone. Task 5's "Unmount
commits" bullet is satisfied only for writes that never failed.

Fix direction: restore `lastAutoSavedRef.current` to its pre-write value in a
`.catch` (not `.finally`), so the next debounce/blur/unmount retries.

`NoteSheet.stories.tsx` has no rejecting-`onAutoSave` story at all; Task 5 needs
one that asserts the retry, not just the happy debounce.
