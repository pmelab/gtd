# Review: 8ca9129

<!-- base: 8ca9129cee00ef95f2226a2690adeefde4b5859e -->

Follow-up fixes from the previous review of the event-sourced state-machine
refactor. Four independent items: two correctness-hygiene fixes (review-base
payload coherence, CRLF-safe commit subjects) and two test-coverage additions
(prompt leaves, machine guard edge cases). All landed in commit `e0bac24`.

## Keep review-base payload coherent

`gatherEvents` previously set `reviewBasePresent` from
`Option.isSome(reviewBase)` while `refDiff`/`baseRef` were only populated for a
non-empty diff, so a same-tree review base produced an incoherent
`reviewBasePresent: true` / `refDiff: undefined` payload. `reviewBasePresent`
now initializes to `false` and flips to `true` only inside the non-empty-diff
branch, so the two fields always agree. The machine guard was already defensive,
so no observable behavior changed.

- [ ] ./src/Events.ts#207

## CRLF-safe commit subjects

`commitSubjects` filtered blank lines but did not trim, so a CRLF checkout left
a trailing `\r` on every subject (unlike sibling git operations). Each line is
now trimmed before the length filter; a new test simulates a CRLF checkout and
asserts no subject carries `\r`.

- [ ] ./src/Git.ts#152
- [ ] ./src/Git.test.ts#291

## Cover remaining prompt leaves

Adds `buildPrompt` cases for the `execute`, `cleanup`, `decompose`, and
`execute-simple` leaves — each asserts its section renders, includes the
auto-advance partial, and does not leak another leaf's section.

- [ ] ./src/Prompt.test.ts#105

## Cover review-base / escalate guard edges

Adds machine cases for `reviewBasePresent: true` with empty/whitespace `refDiff`
resolving to `verified` (regression guard for the Events.ts fix), and for
`escalate` winning over the post-cap leaves (`human-review`, `modified-todo`)
once the `fix(gtd):` counter hits the cap. Deliberately asserts nothing about
escalate vs. earlier-priority leaves, which the guard ladder reaches first.

- [ ] ./src/Machine.test.ts#154
- [ ] ./src/Machine.test.ts#173
