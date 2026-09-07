# Spec feedback — 04 — steering screens and dictation

Verified `64dd325f2a58a6de056fd6d12472d035bc132194`..working tree. T1, T3's
parser/selection, T8 and the T5 section-order validator rule hold up. The items
below do not.

## 1. No diff ever reaches the hunk screen (T3, T4, concern 3)

`src/serve/Diff.ts#resolveDiff` is complete and tested, but
`src/serve/Router.ts` registers only `runCommand`/`fleet`/`writeNote`/`view` —
there is no `diff` procedure — and `Review.tsx#Review` passes `diffs: undefined`
by construction (its own doc comment says so). Every shipped hunk screen renders
`hunk-diff-loading` forever.

That makes concern 3's "syntax-highlighted diff of `base..HEAD` sliced to the
pointed-at hunk", T4's "with the diff sliced to the pointed-at hunk", and T3's
"the screen shows that path's whole diff behind a banner" unreachable in the
product. Package 05 contains no diff task either, so nothing later picks it up.
The banner/binary/refused branches exist only in `Hunk.stories.tsx` fixtures.

## 2. The chunk-footnote badge is dead for a real document (T4 acceptance)

`ReviewDoc.ts#reviewView` sets `note` only on hunk children; `Changeset` has no
note field and the chunk node never carries one. `Review.tsx#hasNoteText(chunk)`
therefore reads `undefined` for every chunk footnote actually present in the
file, so the badge only ever appears after the human types a note in this
session. `Review.stories.tsx:61` fabricates `note:` on a chunk view node — a
shape the format's `view` cannot produce, so the story proves nothing about the
acceptance bullet "a chunk carrying a footnote keeps the round open even when
every hunk in it is ticked". Chunk-level footnotes are parsed elsewhere
(`reviewOutline` renders them as chunk children), so the data exists; `view`
just doesn't project it.

## 3. The paragraph note seam is a non-functional button (T6, concern 4)

`Plan.tsx#ProseParagraphs` renders `note-seam-<index>` with no `onClick`, no
`NoteSheet`, and no `{kind:"paragraph", line}` anchor — it keys on the
paragraph's array index and never resolves a document line. The seam's own doc
comment defers the wiring to "a different task/file", but T6 owns it: "the sheet
opens from a chunk, from a hunk, and from a paragraph seam" and "a paragraph
already carrying a note offers editing it, not a second note". Both are
unsatisfied outside `NoteSheet.stories.tsx`, which hands the sheet a
hand-written `{kind:"paragraph", line:12}` no screen ever constructs.

## 4. The prose-only view yields no paragraphs (T2)

T2's criterion is "a prose-only steering file yields paragraphs and no
questions", in `src/serve/View.ts`'s output. Instead `Plan.tsx#paragraphsOf`
splits raw markdown on blank lines in the client — the exact server-side
projection T2 exists to own, and it also means the paragraph anchor has no line
number to attach to (see item 3). `View.test.ts` covers neither this criterion
nor "the question view yields open questions and answered questions separately";
`questionsView` returns one flat node list and the split is re-derived in
`PlanBody` by filtering on `status`.

## 5. The client re-derives the answered predicate against the wrong placeholder (T5)

`Question.tsx#normalizeAnswerText` compares typed text case-insensitively
against its own rendered hint `"Type your answer…"`. The format's placeholder is
`OpenQuestions.ts#FREE_TEXT_PLACEHOLDER === "_your answer_"`. So the criterion
"a placeholder differing only in letter case still normalizes to empty" is met
only for a string the format has never heard of: a human who types
`_Your Answer_` reads as answered on the phone while the landing gate and the
open-questions check both normalize it to empty. T5 states the predicate
"already exists and is the single one enforced" — this is a second, divergent
copy.

## 6. Dictation gaps (T7)

- "interim results are displayed but never written through": `Mic` exposes
  `state.interim`, but neither consumer renders it —
  `Question.tsx#FreeTextOption` and `NoteSheet.tsx` both ignore `interim`
  entirely. Never written through: yes. Displayed: nowhere in the product.
- `Mic`'s `onend` always calls `onAttach(finalRef.current)`, including when the
  session produced nothing (a stop with no speech, or after a `not-allowed`
  error). In `FreeTextOption` that fires `onFocus()` → `onSelect()`, so tapping
  Dictate and stopping silently ticks the free-text option and appends a
  trailing space to the answer. Attach should be skipped on an empty final
  transcript and on the error path.

## 7. Neither screen is reachable, and nothing persists

`App.tsx` mounts neither `Review` nor `Plan` (both carry
`fallow-ignore-next-line unused-export` and a comment deferring routing);
package 05 has no routing task. Ticks and answers are local `useState` only —
`ReviewDoc.ts#toggleFilePointer` is never exposed through the router, and
`Review.tsx#saveNote` updates local state without calling the existing
`writeNote` procedure. Concerns 3 and 4 are PRODUCT requirements; as built,
nothing a human does on either screen survives a reload.

## 8. Scroll restoration lives only in the story harness (T1)

"back from the first deck item returns to the list without losing scroll
position" is implemented by `Card.stories.tsx#TwoLevelShellDemo`'s own
`scrollBefore` ref plus a `requestAnimationFrame(window.scrollTo)`. Neither
`Deck.tsx` nor `Review.tsx`/`Plan.tsx` does any of that, so no shipped screen
preserves scroll — the criterion passes against test-only code.
