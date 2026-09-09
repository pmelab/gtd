# Spec feedback — 02 thumb layout and visual design

Two gaps against `.gtd/packages/02-thumb-layout-and-visual-design.md`.
Everything else checks out: `npm test` green (10/10 turbo tasks), `test:web` 136
tests green run uncached, `npm run build` emits a non-empty `dist/web/main.css`
whose utilities land inlined in `src/web/generated.html` with no external
`href`/`src` left.

## 1. Native checkboxes and radios are under the 44px floor

Requirement (a) is blanket: "no hit target below 44×44 CSS px". Three native
form controls were never sized and never measured:

- `src/web/screens/Review.tsx:376` — `chunk-check-all-<i>` is a bare
  `<input type="checkbox">` with no class at all and no wrapping label. Tailwind
  preflight does not resize form controls, so the tap target is the browser
  default (~13×13 CSS px) — the single smallest target in the app, and it sits
  directly beside two `Button`s that DO clear the floor, so a mis-tap opens the
  chunk instead of ticking it.
- `src/web/screens/Hunk.tsx:157` — `hunk-tick`, the approve gesture. Wrapped in
  a `<label>`, but the label is `flex items-center gap-2` with no `min-h-11`, so
  the row is one line tall (~21px), not 44.
- `src/web/screens/Question.tsx:190` — `option-radio-<i>`, same shape, same
  missing `min-h-11` on its `<label>`.

No story measures any of the three. Task 6's acceptance enumerates the `Button`
call sites only, but requirement (a)'s floor is not scoped to buttons, and these
are the app's most-tapped controls.

Fix shape: size the control (or its label row) to the floor and add the same
`getBoundingClientRect()` ≥ 44 assertion at `page.viewport(390, 844)` the other
controls already carry.

## 2. `Card`'s pressed state has no story and no assertion

Task 6: "Every restyled control has a default, a pressed and a disabled story."
`src/web/Button.stories.tsx` covers all three variants with real
`getComputedStyle` checks, and every `Button` call site inherits that.
`src/web/Card.tsx:17` is the one restyled control NOT routed through `Button` —
it hand-writes its own `active:bg-surface` — and `Card.stories.tsx` has only
geometry and scroll stories. Nothing pins that the pressed state differs from
rest, so dropping `active:bg-surface` breaks no test.

Fix shape: a pressed story mirroring `Button.stories.tsx`'s `SecondaryPressed`
(assert `backgroundColor` under a held pointer differs from rest). `Card` has no
disabled shape, so no disabled story is owed.
