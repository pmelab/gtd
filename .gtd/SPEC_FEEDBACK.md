# Spec feedback — 04 steering screens and dictation

All 8 tasks' files exist, the suite is green (64 storybook tests, 10 turbo
tasks), and most bullets hold. The problems below are real defects or bullets
satisfied only on paper. Persistence of ticks/answers is package 05's `done`
action and is NOT counted against this package.

## 1. Binary detection misclassifies text diffs (T3)

`src/serve/Diff.ts:119` — `diffOutcome.stdout.includes("Binary files ")` is an
unanchored substring search over the whole diff body. Any TEXT file whose diff
content contains that string renders "Binary file — no diff to show" instead of
its diff. Self-inflicting: `src/serve/Diff.test.ts:209` contains the literal
`Binary files a/image.png and b/image.png differ`, so reviewing gtd's own
`Diff.test.ts` in the review UI shows the binary placeholder. Anchor the match
to a line start, or corroborate with "no hunk headers parsed". Needs a test with
a text diff whose body contains that string.

## 2. Nothing is actually syntax-highlighted (concern 3, T8)

`Highlight.ts` emits `className` values `com`/`str`/`kw`/`num`/`typ`, rendered
at `src/web/screens/Hunk.tsx:44-48`. Those class names have NO styles anywhere —
no `.css` in `src/web`, no `<style>` in `src/web/index.html`, nothing in
`.storybook/preview.ts`. Every token paints the same color. Only the per-line
add/del backgrounds (`Hunk.tsx:26-31`) are visible. The requirement says
"syntax-highlighted diff"; the tokenizer is correct and its output is inert.

## 3. Whole-file fallback concatenates hunks with no separator (T3/T8)

`src/web/screens/Hunk.tsx:55` — `flattenLines` is
`diff.hunks.flatMap(h => h.lines)` and drops `hunk.header` (parsed and stored at
`Diff.ts:52`). In the unresolved-pointer fallback, non-contiguous regions of a
file render as one continuous block with no `@@` line and no gap marker, so a
reader cannot tell where one hunk ends. T8's "a hunk header renders
unhighlighted" is unit-tested (`Highlight.test.ts:70`) but that path is
unreachable in the app — no header ever reaches `highlightDiffLine`.

## 4. A chunk with zero hunks is a blank dead-end (T4)

`src/web/screens/Review.tsx:265-268` leaves the open button enabled when
`hunksOf(chunk)` is empty (only the check-all at `:262` is disabled). Tapping it
sets `openChunkIndex`, `ReviewView` returns `HunkDeck` exclusively (`:363-366`),
and `Deck.tsx:59` returns `null` for an empty item list — no content, no Back
control, unrecoverable without a reload. This shape is real and pinned: a `##`
chunk with prose and no pointers parses to `files: []`
(`src/ReviewDoc.ts:397-404`, `ReviewDoc.test.ts:250-268`). No story covers it.

## 5. Dictation overwrites text typed during the session (T7)

`src/web/screens/Question.tsx:40-43` closes over `freeText` by value, and
`Mic.tsx:125` assigns `recognition.onend` ONCE inside `start`, capturing the
`onAttach` prop from the render in which Dictate was tapped. Tap Dictate on an
empty field, type "hello", stop → the attach handler still sees
`freeText === ""` and the typed "hello" is replaced by the dictated text alone.
`NoteSheet.tsx:89-91` is immune because it uses a functional updater; use the
same shape here, or hold `onAttach` in a ref inside `Mic`. No story types during
a session, so the suite stays green.

## 6. The note sheet footer overlays the textarea and hides behind the keyboard (T6, and T1's no-overlay rule)

`src/web/NoteSheet.tsx:72-86` pins the footer with `position: fixed; bottom: 0`.
The doc comment at `:63-71` claims this keeps Save reachable when a software
keyboard opens. That is false on the target platform: `src/web/index.html:5` has
no `interactive-widget=resizes-content` and there is no `visualViewport`
handling anywhere in `src/web`, so on iOS Safari and default Android Chrome
`fixed` resolves against the layout viewport and the footer ends up BEHIND the
keyboard — the exact failure the comment claims to prevent. Two further
consequences: `fixed` removes the footer from flow, so the `flex: 1` textarea
(`:51-61`) grows to full `100dvh` and the footer permanently covers its bottom
~48px; and `left: 0; right: 0` spans the viewport, not the sheet's
`maxWidth: 390` box (`:44-45`). The story (`NoteSheet.stories.tsx:115-133`)
asserts only `position === "fixed"` and admits it cannot simulate a keyboard —
it pins the mechanism, not the bullet.

## 7. The paragraph note seam is invisible and a 6px touch target (T6)

`src/web/screens/Plan.tsx:100-109` —
`height: 6, border: "none", background: "none"`. Full-width and correctly below
the paragraph, so the bullet passes literally, but it renders zero visual
affordance on a 6px tap target. This seam is the entire replacement for the
selection gesture the spec says was built and rejected on a phone; a control the
user cannot see or reliably hit is not a working replacement. The stories only
`getByTestId` it and click programmatically — a 0×0 element would pass
identically.

## 8. An already-answered question drills into an empty screen labelled "unanswered" (T5)

`QuestionSection` wires `onOpen` for both sections (`Plan.tsx:193-207`), so an
"Already answered" card is tappable. `src/OpenQuestions.ts:327` gives a question
in the answered section `options: []`, so `Question.tsx` renders lastIndex `-1`,
`selected` undefined, and prints `"unanswered"` (`:131-138`) on a screen with no
options at all — the status line contradicts the section the card came from.
Either render `node.status`/`node.answered` for the server-derived state, or
don't make answered cards drillable. No story opens one
(`Plan.stories.tsx:35-41` builds one and never taps it).

## 9. The client's answered rule diverges from the enforced one (T5)

T5 says the predicate "already exists and is the single one enforced".
`src/OpenQuestions.ts:295-300` `isAnswered` is module-private, and
`Question.tsx:131-132` recomputes the rule from local state instead. The
divergence: the server returns false when `ticked.length !== 1`, while the
client takes the FIRST checked option (`Question.tsx:123`) and renders
"answered". A document with two ticked options reads answered on the phone and
still blocks landing. Export the predicate over `{checked, text, freeText}` and
call it in both places, or seed from `node.answered` and only override on local
edits.

## 10. PlanView re-implements a hash the server already ships (T5)

`src/web/screens/Plan.tsx:17-24` hand-rolls FNV-1a over the file content, while
`readSteeringFile` already returns `contentHash` and the same component uses it
at `:322`. `content` is passed into `PlanView` (`:332`) for no purpose other
than re-deriving that hash — two hashes of the same bytes side by side. Pass the
server's `contentHash` down instead and delete `hashContent`.

## Smaller items

- `src/web/screens/Hunk.tsx:113-115` renders "Hunk 1 of 3" while
  `Deck.tsx:27-29` renders "1 / 3" below the same content — two progress
  indicators, two notations.
- `Review.stories.tsx:180` (footnote keeps the round open) asserts the badge's
  own hard-coded string; it cannot fail if the badge renders. The real predicate
  is the `HEAD^`-vs-`HEAD` byte compare at `src/workflows/unified.yaml:840-844`,
  and nothing connects the two.
- The "imports no format module, switches on no mode name" source-text guard
  (`View.test.ts:58-64`) covers `View.ts` only. A format import into `Router.ts`
  passes green.
- `reviewView`'s `detail` (a chunk's prose) is asserted by no test in the repo.
- `Deck.stories.tsx:97-98` asserts only `position !== "absolute"`; `fixed` and
  `sticky` both pass, which is exactly the regression `NoteSheet` demonstrates.
- `src/web/screens/Review.tsx:397-409` and `Plan.tsx:311-326` ignore the
  `writeNote` mutation result. A CONFLICT refusal leaves the local note override
  in place forever (`Review.tsx:99`), so the "Note keeps this round open" badge
  keeps claiming a footnote that was never written.
