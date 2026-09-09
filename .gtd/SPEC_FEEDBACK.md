# Spec feedback — 02 One-thumb layout and deliberate visual design

Tasks 1–5 and 7 check out: build emits and inlines `dist/web/main.css`, both
inlining paths are guarded and tested, `tokens.test.ts` parses the real
`@theme`, the deck bar is geometrically pinned at 390×844 and 390×500, scroll
restoration is element-based, and all seven text states route through `Notice`.
Two Task 6 problems remain.

## 1. `Review.tsx:392` hand-rolls a disabled state — and drops it under 3:1

`src/web/screens/Review.tsx:392` — the chunk-open control carries
`className="flex-1 text-left disabled:opacity-60"`. Task 6 puts default /
pressed / disabled in `Button.tsx`; ghost already supplies
`disabled:text-disabled disabled:pointer-events-none`
(`src/web/Button.tsx:22,33`). The call-site `disabled:opacity-60` is exactly the
hand-rolled state the task removes.

It also breaks Requirement (b)'s contrast floor: `--color-disabled` `#5a5a5e` at
60% opacity over `--color-page` `#111111` composites to ≈`#3d3d3f`, about
**1.8:1** against the page — under the 3:1 large-text/control threshold.
`tokens.test.ts` cannot catch this: it reads token values, and the opacity is
applied at the call site, not in `styles.css`.

Its own story comment states the opposite and is therefore false today:
`src/web/screens/Review.stories.tsx:139` — "`Button`'s `disabled:` utilities
apply, not a hand-rolled opacity/cursor pair".

Fix direction: delete `disabled:opacity-60`; if the ghost disabled treatment is
not distinct enough, change it once in `Button.tsx` and add the pair to
`tokens.test.ts`.

## 2. `Review.stories.tsx:151-154` asserts nothing about the disabled look

`ChunkOpenButtonDisabledWhenNoHunks` only does
`expect(canvas.getByTestId("chunk-open-0")).toBeDisabled()` — a DOM-attribute
check. The story's own comment claims the disabled state is "visually distinct",
and Task 6's criterion is a real disabled story per control.
`Button.stories.tsx:98` shows the shape that satisfies it: assert the computed
style (background/colour) differs from the enabled state.

## 3. Pressed-state stories missing at the converted call sites

Task 6: "Every restyled control has a default, a pressed and a disabled story."
`Button.stories.tsx` covers all three per variant, and `Card.stories.tsx:166`
does a real pressed check. Nothing else does. No pressed story exists for
`deck-prev`/`deck-next` (`Deck.stories.tsx` has no press at all), for
`note-sheet-dismiss`/`note-sheet-save`/`note-sheet-mic`/ `note-sheet-done`
(`NoteSheet.stories.tsx`), or for `chunk-open-<i>`/`chunk-note-<i>`
(`Review.stories.tsx`). Disabled is genuinely n/a for the Deck and NoteSheet
controls — they take no `disabled` prop — so pressed is the gap to close, using
`Card.stories.tsx:166`'s real-mouse-press pattern.
