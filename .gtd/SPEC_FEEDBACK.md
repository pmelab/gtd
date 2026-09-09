# Spec feedback — 02 One-thumb layout and deliberate visual design

The styling mechanism, both inlining paths, the token contrast test and the
element-based scroll restoration all land as specified. Five acceptance criteria
are not met.

## Task 6 — no pressed or disabled stories for the new control system

Criterion: "Every restyled control has a default, a pressed and a disabled
story, so `npm run storybook` is a real judgement surface at review."

`Button.tsx` declares `active:` and `disabled:` utilities for all three
variants, and nothing exercises them. Across every `*.stories.tsx` under
`src/web/` there is exactly one disabled story
(`Review.stories.tsx#ChunkOpenButtonDisabledWhenNoHunks`) and ZERO pressed
stories, and there is no `src/web/Button.stories.tsx` at all. Requirement (b)
asks for "states (default / pressed / disabled) for every control"; the pressed
state currently ships unseen and unasserted.

## Task 6 — Back/Next never gets its 44×44 assertion

Criterion names the controls explicitly: "Card rows, the NoteSheet trio, both
Review chunk controls, Back/Next, and the hand-back."

`deck-prev`/`deck-next` have no `getBoundingClientRect()` width/height ≥ 44
assertion anywhere — `Deck.stories.tsx` measures only the bar's position, never
either button's box. Card rows, the NoteSheet trio (incl. `note-sheet-done`, the
hand-back) and both Review chunk controls are covered; the deck's two controls
are the gap.

## Task 4 — the long-item story does not prove the bar stays put

Criterion: "A long-item deck story proves the bar stays put while the content
scrolls."

`Deck.stories.tsx#ControlBarStaysPutWhileLongContentScrolls` sets
`content.scrollTop = 1500` and then reads the bar's rect exactly ONCE, into a
variable named `barRectBefore`, with no before/after comparison. It also never
asserts the content actually scrolled (`content.scrollTop` is never read back),
so the story passes unchanged if the scroll container overflows nowhere — e.g.
if `overflow-auto` or `min-h-0` were dropped from `deck-content`, the exact
regression Task 4 exists to prevent. Capture the rect before the scroll, assert
`content.scrollTop > 0` after it, and assert the rect is unchanged.

## Task 7 — the query-error state has no story

Criterion: "All five `App.tsx` states render through `Notice`, each with a
story."

`App.stories.tsx` covers loading (`app-loading`), broken (`app-broken`),
moved-on (`app-moved-on`) and unrenderable (`app-unrenderable`). Nothing renders
`app-query-error` — neither the `query.isError` branch nor the
`step === undefined` branch that shares its `data-testid`. Four of five.

## Task 7 — refusal vs Saved distinctness is not asserted

Criterion: "The refusal banner and the `Saved` label are visually distinct —
different tone, asserted on a computed style, not by eye."

`Refusal.tsx` does pass `tone={refusal !== undefined ? "error" : "info"}`, and
no test reads a computed style off `refusal-banner`. `grep getComputedStyle`
over `src/web/` hits only `NoteSheet.stories.tsx` and `Hunk.stories.tsx`; the
only `refusal-banner` assertions (`Plan.stories.tsx#681,688`,
`Question.stories.tsx#680`) are presence checks. Add a story that asserts the
refusal banner's computed border (the sole difference between `Notice`'s two
tones) differs from the `Saved` banner's.
