# Spec feedback — 03-refusals-and-durability

## Task 7 — `Question.tsx` still snapshots and restores the whole answer

`src/web/screens/Question.tsx:280` and `:307` both do `const previous = answer`,
and `commitAnchor`'s catch at `:274` does `onAnswerChange(previous)`. That is
the whole-`answer` snapshot Task 7 says is gone. The `seqRef` guard is
per-ANCHOR, but the revert it gates is whole-OBJECT, so a stale rejection on one
anchor still clobbers a later, already-landed write on a different anchor of the
same question.

Concrete failure: tick option 0 (slow write), then tick option 1 (lands). Option
0's write rejects. `seqRef.get(key0)` is still option 0's own seq, so the catch
fires `onAnswerChange({selected: undefined, freeText: ""})` — option 1's tick
vanishes. This is verbatim the spec's "Tick A, tick B, A's write fails, B's tick
vanishes too".

Same defect on the free-text path: a refused free-text commit restores
`previous.selected` as well as `previous.freeText`, discarding any radio tick
made while the write was in flight.

`Review.tsx` got this right (per-key revert, `:210`, `:229`). `Question.tsx` did
not. Task 7's bullets "No handler snapshots whole state any more" and
"`Question.tsx#247`'s whole-`answer` snapshot is gone" are unmet.

No story covers this at the `Question` layer either — `Review.stories.tsx:219`
is the only anchor-A/anchor-B assertion, and it exercises the code path that
already works.

## Task 4 — a seventh copy of the fallow paragraph survives

`src/web/screens/Plan.tsx:64-66` still carries it:

> Exercised by `Plan.stories.tsx`'s `play()` interaction tests — fallow's static
> CRAP estimate only sees real coverage reports, not Storybook/vitest- browser
> runs, so it scores this as untested regardless.

Task 4 says all six copies are deleted, and Plan was one of the ×3 sites. Delete
this one too; the `// fallow-ignore-next-line complexity` pragma below it stays.
