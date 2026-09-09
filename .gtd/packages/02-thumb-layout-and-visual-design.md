# 02 — One-thumb layout and deliberate visual design

Two requirements, one package: they edit the same files and the same
declarations — `Card.tsx`, `NoteSheet.tsx`, `Refusal.tsx`, `App.tsx` and the
four screens — one for sizes, the other for colour and type. Both are carried
below independently.

## Requirement (a) — PRODUCT: Make every control reachable and hittable with one thumb

The phone UI's controls sit wherever document flow leaves them, at whatever size
the browser's default `<button>` gives them. On a review screen with a long hunk
list, `Deck`'s Back/Next row scrolls off the bottom entirely — the human has to
scroll to advance, then scroll back. Nothing is anchored to the thumb arc, and
no target is sized for a thumb.

Redesign the interaction layout around one-handed use: primary actions
permanently inside the thumb-reachable bottom third, no hit target below 44×44
CSS px, and no primary action that requires scrolling to reach.

**Only `Deck.tsx`'s Back/progress/Next row becomes the anchored bar.**
`Review`'s hand-back, `NoteSheet`'s save and the chunk-level controls stay in
flow where they are, sized up to the 44px floor — no shared bottom-bar
component, and nothing new competing with `NoteSheet`'s sheet for the bottom of
the screen while the keyboard is open.

**This concern also builds the one home for sizing and spacing values**, because
a 44px floor and a spacing rhythm cannot land as literals re-typed in eleven
files. Styling today is inline `style={{ … }}` objects across `App.tsx`,
`Card.tsx`, `Deck.tsx`, `Mic.tsx`, `NoteSheet.tsx`, `Refusal.tsx` and all four
screens (`Hunk.tsx`, `Plan.tsx`, `Question.tsx`, `Review.tsx` — the last two
~24KB each). Pick one mechanism, route every value through it, and let the
visual concern below add palette and type scale to the same place. There is no
CSS file in the repository today and no CSS framework — the mechanism is an open
technical choice, not a given.

- `src/web/Deck.tsx#23` — Back / progress / Next is a
  `justify-content: space-between` row with `padding: 12px`, placed as in-flow
  content below `renderItem`. Its doc comment declares "never absolutely
  positioned, so it can never overlay `renderItem`'s output" — that constraint
  was chosen to prevent overlay, and it is what pushes the row off-screen.
  Whatever replaces it must satisfy both: reachable without scrolling AND never
  covering content. Expect a scroll container with a fixed control bar plus
  bottom padding on the content, not a change of `position` alone.
- `src/web/Deck.stories.tsx#107` is the blocker, and it is deliberate: the story
  asserts `getComputedStyle(controls).position === "static"` and its comment
  names `fixed` and `sticky` as values it exists to reject. An anchored bar
  fails that assertion by design. Rewriting that contract — from "position is
  static" to "the bar is inside the 844px-tall viewport without scrolling AND
  its top edge is at or below the content box's bottom, with the content padded
  by the bar's height" — is part of this concern, not collateral damage.
- `src/web/Card.tsx#21` — list rows are `<button>` with `padding: 10px 12px` and
  no `min-height`. A one-line row lands near 38px tall, under the 44px floor,
  and rows are separated only by a 1px `#333` rule, so a mis-tap opens the
  neighbour.
- `src/web/Card.tsx#22` — `borderBottom: "1px solid #333"` is immediately
  followed by `borderBottomWidth`, `borderBottomStyle` and `borderBottomColor`
  restating the same rule longhand. Dead duplication inside a single style
  object; a sign the inline approach is already unmanaged.
- `src/web/NoteSheet.tsx#232` — dismiss, save and mic are bare `<button>`s with
  no sizing at all. The sheet already solves keyboard overlap via
  `interactive-widget=resizes-content` and `100dvh` (see the comment in
  `src/web/index.html#5`); thumb sizing is the unsolved half.
- `src/web/screens/Review.tsx#368`, `src/web/screens/Review.tsx#401` — the same
  bare-`<button>` pattern for opening a chunk and opening its note sheet, two
  adjacent unstyled targets.

**Acceptance is mechanical, in the browser, not by eye**: `npm run test:web`
runs the `*.stories.tsx` play functions in a real browser through
`@storybook/addon-vitest`, where `page.viewport(390, 844)` and
`getBoundingClientRect()` are already in use — `Card.stories.tsx#141` sets that
viewport and `Plan.stories.tsx#250` already asserts a `>= 44` height on the note
seam. Every restyled control gets the same geometric assertion at 390×844, and
the bar gets one that its box lies within the viewport with zero scroll.

Risk: `interactive-widget=resizes-content` shrinks the layout viewport when the
keyboard opens, so any bottom-anchored bar computed from `100dvh` moves with it.
Verify the bar with the keyboard open, not just closed —
`NoteSheet.stories.tsx#141` already stands in for that with
`page.viewport(390, 500)`; the bar needs the same short-viewport story.

## Requirement (b) — PRODUCT: Give the UI a deliberate visual design

There is no visual design. `src/web/index.html` sets `color-scheme: dark`,
`background: #111`, `color: #eee` and a system font stack; everything else is
browser default. Buttons render as grey OS chrome on a near-black page, there is
no type scale, no spacing rhythm, no accent colour, and no visual distinction
between a primary action and a dismissal.

Design it on purpose, through the mechanism the concern above establishes: a
type scale, a colour palette with a defined accent, and states (default /
pressed / disabled) for every control. Contrast must clear WCAG AA — 4.5:1 for
body text, 3:1 for large text and control boundaries. Ratios get asserted
against the token values, not eyeballed.

**Dark-only.** `color-scheme: dark` stays, there is no light palette and no
`prefers-color-scheme` branch: one palette to design, one set of contrast ratios
to prove.

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
- `src/web/Refusal.tsx`'s banner is the seventh such state, and the first
  concern above proves the human actually reads it. It needs a designed
  treatment — legible against the dark page, distinct from a `Saved` label
  sharing the same live region.
- The four `*.stories.tsx` screen files (`Review.stories.tsx` ~32KB,
  `Plan.stories.tsx` ~30KB, `Question.stories.tsx` ~29KB, `Hunk.stories.tsx`
  ~14KB) are the harness for judging the result — every restyled control needs
  its default/pressed/disabled states visible there, and `npm run storybook` is
  how the visual gets checked without a phone in hand.

**Risk, blunt — a CSS asset would be dropped silently.**
`scripts/inline-web-client.mjs` reads exactly `dist/web/main.js` and inlines
that one file into `src/web/index.html`, producing `src/web/generated.html`
(gitignored, regenerated by `npm run build`, imported by the node bundle through
tsdown's `.html` text loader). It throws only when the `<script>` tag is missing
— it never looks for an emitted stylesheet. If the styling mechanism makes the
web build emit `main.css`, Storybook and Vite will look perfect while the served
phone UI ships unstyled, and no gate catches it: `test:web`'s turbo inputs
explicitly exclude `src/web/generated.html`. Either keep tokens JS-resident so
the bundle stays one file, or make the inline step fail loudly on an un-inlined
asset.

## Task 1 — Tailwind CSS v4 as the one styling mechanism

Tailwind is the mechanism: utility classes at every call site, no
`style={{ … }}` objects left anywhere under `src/web/`. v4 is CSS-first, so the
token home is an `@theme` block in one new stylesheet, `src/web/styles.css`:
`--color-*` (page, surface, border, text, muted, accent, accent-pressed,
disabled) and `--text-*` (size + line-height pairs). Tailwind's default 4px
spacing scale is kept as-is, which makes the 44px floor exactly
`min-h-11 min-w-11` — one utility, no literal to retype. Dark only: no `dark:`
variant, no `prefers-color-scheme` branch, no second palette. `@source "./"`
declares the scan root explicitly rather than relying on auto-detection.
`src/web/index.html`'s three hardcoded values (`background: #111`,
`color: #eee`, the font stack) move into the stylesheet's base layer;
`color-scheme: dark` stays.

The CSS is built by the Tailwind CLI as its own build step, never by tsdown:
`npx @tailwindcss/cli -i src/web/styles.css -o dist/web/main.css` runs between
`tsdown --filter web` and the inline step in `npm run build`. tsdown's browser
config keeps a single JS entry and stays CSS-free — there is no PostCSS in
rolldown, no CSS import from `main.tsx`, no second emitted asset for it to
reason about. Storybook and the `test:web` browser project get the same
stylesheet through `@tailwindcss/vite` in `.storybook/main.ts`'s `viteFinal`
plus an import of `../src/web/styles.css` in `.storybook/preview.ts` — one
source file, two consumers, no duplicated palette.

Paths: `src/web/styles.css`, `src/web/index.html`, `package.json`,
`.storybook/main.ts`, `.storybook/preview.ts`, `turbo.json`.

- [ ] `npm run build` produces a non-empty `dist/web/main.css` containing
      compiled utilities, not just the `@theme` declarations.
- [ ] No file under `src/web/` contains a `style={{` literal after this package
      lands.
- [ ] A Storybook story renders with Tailwind utilities applied, proving
      `.storybook` wiring works in the `test:web` browser project.
- [ ] `turbo.json`'s `build` and `test:web` tasks list every new input
      (`src/web/styles.css` is under the existing `src/**`; `.storybook/**`
      already listed) and `tests/tooling/turbo.test.ts` stays green.

## Task 2 — Both HTML-inlining paths carry the CSS

**Risk, blunt: `gtd ui --dev` is a second, separate inlining path and will serve
unstyled if only the packaged build is fixed.**
`src/ui/Server.ts#resolveClientHtml`'s dev branch runs
`npx tsdown --filter web`, reads `dist/web/main.js`, and calls the shared
`src/ui/scriptTag.mjs#inlineScript` — it never touches
`scripts/inline-web-client.mjs`.

The CSS inlining therefore lands in `src/ui/scriptTag.mjs` as
`STYLE_TAG_PATTERN` + `inlineStyles(template, css)`, next to its existing
`<\/script>` escaping sibling — a literal `</style>` inside the CSS gets the
same guard. Both call sites use it: `scripts/inline-web-client.mjs` and
`Server.ts`'s dev branch, which also runs the Tailwind CLI before reading.

**The build trap is now live, not hypothetical — Tailwind emits exactly the
asset the inline step was blind to.** `scripts/inline-web-client.mjs` today
throws only on a missing `<script>` tag and never looks at anything else in
`dist/web/`. It now inlines `dist/web/main.css` AND throws when that file is
missing, empty, or when any emitted `dist/web/` asset is left un-inlined.

`test:web` cannot be the gate here — its turbo inputs exclude
`src/web/generated.html` and Storybook never reads it. The tooling test is.

Paths: `src/ui/scriptTag.mjs`, `scripts/inline-web-client.mjs`,
`src/ui/Server.ts`, `tests/tooling/`.

- [ ] A `tests/tooling/` test: the inline step throws when `dist/web/main.css`
      is missing.
- [ ] The same test file: it throws when `dist/web/main.css` is empty.
- [ ] The same test file: it throws when any other emitted `dist/web/` asset is
      left un-inlined.
- [ ] `src/web/generated.html` after `npm run build` is one self-contained file
      with a non-empty `<style>` block and no external `href`/`src` reference.
- [ ] A CSS payload containing a literal `</style>` is escaped, not left to
      terminate the tag early.
- [ ] A `Server.ts` test covers the `--dev` branch producing HTML with a
      non-empty `<style>` block.

## Task 3 — Contrast is asserted against the shipped token values

`src/web/tokens.test.ts` (unit project, no browser) reads `src/web/styles.css`,
parses the `@theme` block's `--color-*` declarations, implements WCAG relative
luminance, and asserts every shipped pair. Parsing the real file rather than a
duplicated JS copy of the palette is what keeps the assertion honest.

Paths: `src/web/tokens.test.ts`, `src/web/styles.css`.

- [ ] Body text on its background is ≥ 4.5:1.
- [ ] Large text is ≥ 3:1.
- [ ] Every control boundary against its surface is ≥ 3:1.
- [ ] The accent and accent-pressed colours both clear their pair's threshold.
- [ ] The test fails if a `--color-*` value in `src/web/styles.css` is changed
      to something below threshold — it reads the file, never a constant.

## Task 4 — The deck's control bar is anchored by a viewport-tall flex column

The screen shell becomes a viewport-tall flex column — `h-dvh flex flex-col` on
`body`/`#root`/`App`'s wrapper. Each screen owns exactly one scroll container
(`flex-1 min-h-0 overflow-auto`). **`min-h-0` is mandatory: a flex child's
default `min-height: auto` refuses to shrink and the bar goes off-screen again —
the exact bug being fixed.** The deck's Back/progress/Next row is that
container's `shrink-0` sibling.

Nothing is `position: fixed` or `sticky`. The bar is in flow, so it cannot
overlay content, and it is inside the viewport with zero page scroll because the
column is exactly viewport-tall. `interactive-widget=resizes-content` shrinking
the layout viewport shrinks the scroll area and the bar rides up with it;
nothing new competes with `NoteSheet`'s sheet for the bottom of the screen.

`Deck.tsx`'s doc comment about never being absolutely positioned stays true and
gets rewritten to name the new guarantee.

`Deck.stories.tsx#107`'s contract is rewritten as part of this task, not as
collateral damage.

Paths: `src/web/Deck.tsx`, `src/web/Deck.stories.tsx`, `src/web/App.tsx`,
`src/web/index.html`, `src/web/screens/Plan.tsx`, `src/web/screens/Review.tsx`.

- [ ] At `page.viewport(390, 844)`: the control bar's `getBoundingClientRect()`
      lies entirely inside the viewport with the document not page-scrollable.
- [ ] The existing `compareDocumentPosition` check and
      `controlsRect.top >= contentRect.bottom` both still pass; the
      `getComputedStyle(controls).position === "static"` assertion is dropped as
      the stated contract.
- [ ] A short-viewport deck story at `page.viewport(390, 500)` — the stand-in
      for a keyboard-open layout that `NoteSheet.stories.tsx#141` established —
      asserts both of the above.
- [ ] A long-item deck story proves the bar stays put while the content scrolls.

## Task 5 — Scroll restoration moves off `window`

**Risk, blunt: Task 4 breaks window-level scroll restoration in two places.**
`src/web/useScrollRestoration.ts` reads and writes `window.scrollY`, and
`src/web/screens/Review.stories.tsx#282` and `src/web/Card.stories.tsx#121` both
assert `window.scrollY === 500` after a scroll. Once the page itself no longer
scrolls, `window.scrollY` is permanently 0 and the list silently loses its place
on every deck exit.

The hook becomes element-based — `capture(el)` / `restore(el)` against the
screen's scroll container ref — and both stories move to that element's
`scrollTop`. Ship this with Task 4, never after it: a layout change without the
hook change is a working-looking regression no assertion catches in its old
form.

Paths: `src/web/useScrollRestoration.ts`, `src/web/Card.stories.tsx`,
`src/web/screens/Review.stories.tsx`, `src/web/screens/Plan.tsx`,
`src/web/screens/Review.tsx`.

- [ ] `Review.stories.tsx` scrolls the container to 500, opens a chunk deck,
      exits it, and asserts the container's `scrollTop` is back to 500.
- [ ] `Card.stories.tsx`'s equivalent demo asserts the same on its own
      container.
- [ ] Neither story reads `window.scrollY` any more.
- [ ] `useScrollRestoration` contains no `window.scrollY` / `window.scrollTo`
      reference.

## Task 6 — One control system, every target ≥ 44×44

New `src/web/Button.tsx`: `variant: "primary" | "secondary" | "ghost"`, always
`min-h-11 min-w-11`, with default, `active:`, `disabled:` and `focus-visible:`
states as real pseudo-class utilities. Tailwind's own reset makes the
hand-written `background: none` / `border: none` / `font: inherit` /
`color: inherit` erasure unnecessary — delete it rather than centralise it.

Call sites that today re-erase button chrome by hand stop doing that:
`src/web/Card.tsx` (which also loses its four duplicated `borderBottom*`
longhands restating the same rule, and gains `min-h-11`),
`src/web/NoteSheet.tsx#232`'s dismiss/save/mic trio,
`src/web/screens/Review.tsx#368` and `src/web/screens/Review.tsx#401`'s two
adjacent chunk controls, and `src/web/Deck.tsx`'s Back/Next.

`Review`'s hand-back, `NoteSheet`'s save and the chunk-level controls stay in
normal flow where they are — sized up to the floor, never moved into a shared
bottom bar.

Paths: `src/web/Button.tsx`, `src/web/Card.tsx`, `src/web/NoteSheet.tsx`,
`src/web/Deck.tsx`, `src/web/screens/Review.tsx`, `src/web/Mic.tsx`, and the
matching `*.stories.tsx`.

- [ ] At `page.viewport(390, 844)`, every restyled control asserts
      `getBoundingClientRect()` width ≥ 44 AND height ≥ 44 — Card rows, the
      NoteSheet trio, both Review chunk controls, Back/Next, and the hand-back.
- [ ] A one-line Card row measures ≥ 44 tall (it lands near 38 today).
- [ ] `Card.tsx` contains exactly one border declaration for its bottom rule, no
      longhand restatements.
- [ ] Every restyled control has a default, a pressed and a disabled story, so
      `npm run storybook` is a real judgement surface at review.
- [ ] No component under `src/web/` re-erases button chrome by hand.

## Task 7 — The seven text-only states get one designed block

`src/web/App.tsx`'s loading, query-error, broken, moved-on and unrenderable
branches are five `<div style={{ padding: 16 }}>`s with raw text; the read-error
branch is the sixth; `src/web/Refusal.tsx`'s banner is the seventh. All route
through one `Notice` component with a tone (`info` / `error`), so a refusal
reads visually distinct from the `Saved` label sharing its live region rather
than differing only by a background hex.

Paths: `src/web/Notice.tsx`, `src/web/App.tsx`, `src/web/Refusal.tsx`,
`src/web/App.stories.tsx`.

- [ ] All five `App.tsx` states render through `Notice`, each with a story.
- [ ] The refusal banner and the `Saved` label are visually distinct — different
      tone, asserted on a computed style, not by eye.
- [ ] The banner keeps `role="status" aria-live="polite"` and its `data-testid`
      hooks.
- [ ] No `<div style={{ padding: 16 }}>` remains in `src/web/App.tsx`.
- [ ] `npm test` passes end to end — `format:check`, `typecheck`, `lint`,
      `test:unit`, `test:web`, `deadcode` included.
