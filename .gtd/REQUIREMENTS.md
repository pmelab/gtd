# Requirements

## PRODUCT — Make every control reachable and hittable with one thumb

The phone UI's controls sit wherever document flow leaves them, at whatever size
the browser's default `<button>` gives them. On a review screen with a long hunk
list, `Deck`'s Back/Next row scrolls off the bottom entirely — the human has to
scroll to advance, then scroll back. Nothing is anchored to the thumb arc, and
no target is sized for a thumb.

Redesign the interaction layout around one-handed use: primary actions
permanently inside the thumb-reachable bottom third, no hit target below 44×44
CSS px, and no primary action that requires scrolling to reach.

- `src/web/Deck.tsx#23` — Back / progress / Next is a
  `justify-content: space-between` row with `padding: 12px`, placed as in-flow
  content below `renderItem`. Its doc comment declares "never absolutely
  positioned, so it can never overlay `renderItem`'s output" — that constraint
  was chosen to prevent overlay, and it is what pushes the row off-screen.
  Whatever replaces it must satisfy both: reachable without scrolling AND never
  covering content. Expect a scroll container with a fixed control bar plus
  bottom padding on the content, not a change of `position` alone.
- `src/web/Card.tsx#21` — list rows are `<button>` with `padding: 10px 12px` and
  no `min-height`. A one-line row lands near 38px tall, under the 44px floor,
  and rows are separated only by a 1px `#333` rule, so a mis-tap opens the
  neighbour.
- `src/web/NoteSheet.tsx#232` — dismiss, save and mic are bare `<button>`s with
  no sizing at all. The sheet already solves keyboard overlap via
  `interactive-widget=resizes-content` and `100dvh` (see the comment in
  `src/web/index.html#5`); thumb sizing is the unsolved half.
- `src/web/screens/Review.tsx#368`, `src/web/screens/Review.tsx#401` — the same
  bare-`<button>` pattern for opening a chunk and opening its note sheet, two
  adjacent unstyled targets.

Risk: `interactive-widget=resizes-content` shrinks the layout viewport when the
keyboard opens, so any bottom-anchored bar computed from `100dvh` moves with it.
Verify the bar with the keyboard open, not just closed.

## PRODUCT — Give the UI a deliberate visual design

There is no visual design. `src/web/index.html` sets `color-scheme: dark`,
`background: #111`, `color: #eee` and a system font stack; everything else is
browser default. Buttons render as grey OS chrome on a near-black page, there is
no type scale, no spacing rhythm, no accent colour, and no visual distinction
between a primary action and a dismissal.

Design it on purpose: a type scale, a spacing scale, a colour palette with a
defined accent, and states (default / pressed / disabled) for every control.
Contrast must clear WCAG AA — 4.5:1 for body text, 3:1 for large text and
control boundaries.

- `src/web/index.html#18` — the entire current palette: three hardcoded values
  in one inline `<style>`. This is where a real palette replaces them.
- `src/web/Card.tsx#16` — the inline style block sets `background: none`,
  `border: none`, `font: inherit`, `color: inherit`: work spent erasing default
  button chrome rather than styling it. A designed control system removes the
  need for that reset at every call site.
- `src/web/App.tsx#33` — the loading, query-error, broken, moved-on and
  unrenderable states are all `<div style={{ padding: 16 }}>` with raw text.
  Five user-facing states with no design at all; they are part of "prettier",
  not an exception to it.

## TECHNICAL — One home for styling, replacing per-file inline style objects

A type scale, spacing scale and palette cannot land as literals re-typed in
eight files. Styling is currently inline `style={{ … }}` objects scattered
across `App.tsx`, `Card.tsx`, `Deck.tsx`, `Mic.tsx`, `NoteSheet.tsx`,
`Refusal.tsx` and all four screens (`Hunk.tsx`, `Plan.tsx`, `Question.tsx`,
`Review.tsx`) — `Plan.tsx` and `Review.tsx` are ~24KB each. The same padding and
border colour appear in more than one place already.

Pick one mechanism and route every value through it, so a token has exactly one
definition. The two concerns above depend on this existing first for their
values, even though their visible work comes after.

- `src/web/Card.tsx#22` — `borderBottom: "1px solid #333"` is immediately
  followed by `borderBottomWidth`, `borderBottomStyle` and `borderBottomColor`
  restating the same rule longhand. Dead duplication inside a single style
  object; a sign the inline approach is already unmanaged.
- Each screen has a matching `*.stories.tsx` (`Review.stories.tsx` is ~32KB,
  `Plan.stories.tsx` ~30KB). These are the harness for judging the redesign —
  every restyled control needs its states visible there, and the stories are how
  the visual result gets checked without a phone in hand.

Risk: `src/web/generated.html` is a 1.1MB committed build artifact. Confirm how
it is regenerated before changing any style input, or the served UI will not
match the source.
