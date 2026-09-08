# Spec feedback: 03 — the client opens on the step

One defect. Everything else in the package checks out: `SteeringFormat.apply` is
mandatory and radio/hunk/chunk semantics hold, `writeValue` reuses
`verifyForWrite` and adds no refusal reason, `setValue` takes no `worktreePath`,
`Fleet.tsx`/`Fleet.stories.tsx`/the "← Fleet" button are gone, `App.tsx` holds
no navigation state, both `HandedBackPanel`s are terminal, the chunk check-all
is exactly one `setValue` call, and the reload-survival and on-disk scenarios
exist.

## Focus-then-blur on the free-text slot destroys the human's answer

`src/web/screens/Question.tsx:236` (`commitFreeText`) and
`src/web/screens/Question.tsx:190` (`onFocus={onSelect}`)

The free-text write-through is bound to focus and blur with no check that
anything was typed. Tapping into the textarea and tapping out again — a
one-finger mis-tap on a phone, the exact target device — fires two real writes:

1. `onFocus` → `setSelected(lastIndex)` → `setValue({ checked: true })` on the
   free-text anchor. `setOptionCheckedEdits` is radio, so this **unticks
   whatever option the human had already picked** and ticks the empty free-text
   slot.
2. `onBlur` → `commitFreeText` → `setValue({ checked: true, text: "" })`.
   `questionsApply` treats `text: ""` as present (`opts.text !== undefined`), so
   `replaceOptionTextEdit` **replaces the free-text option's label with an empty
   string** — the line lands on disk as `- [x] `, its placeholder gone and
   unrecoverable.

The optimistic-revert paths do not save this. They revert only on a rejected
mutation; write 1 succeeds. Write 2's outcome depends on a race — if the
`readSteeringFile` invalidation from write 1 has already refetched, its tokens
are fresh and the blank label lands; if not, it refuses `stale-token` and only
write 1's damage persists. Either way the human's picked option is gone and the
question is left ticked-but-unanswered by the server's own `isAnswered` rule.

This is squarely inside T4's "Committing free text calls `setValue.mutateAsync`
with both `checked` and `text` in one call" — the call shape is right, its
trigger condition is not.

No story covers it: every free-text story types before blurring. A fix needs a
`Question.stories.tsx` (or `Plan.stories.tsx`) case that focuses and blurs the
textarea with no typing and asserts **zero** `setValue` calls.
