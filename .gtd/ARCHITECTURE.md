# Architecture

## Concern 1 — Worktree-correct HEAD token and in-place recovery

`liveHeadSha` resolves branch refs against the wrong directory in a linked
worktree, `readSteeringFile` launders the resulting `undefined` into `""`, and
every write refuses forever. Three layers change: the ref read, the read
contract, the client's recovery.

**Ref resolution follows `commondir`.** `src/ui/Beat.ts#liveHeadSha` keeps
reading `HEAD` from the per-worktree gitdir (`worktreeGitDir`, correct as-is)
and keeps the bare-40-hex detached branch untouched. New private helper in the
same file: read `join(gitDir, "commondir")`, trim it, resolve it against
`gitDir` when relative, and fall back to `gitDir` itself when the file is absent
(the non-worktree case). Both remaining lookups — the loose `refs/heads/*` file
and `packed-refs` — resolve against that common directory, never against
`gitDir`. Still filesystem-only: no `git rev-parse` subprocess. That is the
deliberate property of this function and a spawn per read is what it exists to
avoid.

**A sha that will not resolve refuses the READ.** `src/ui/ReadSteeringFile.ts`'s
refusal union gains a third member, `"head-unresolved"`. The `?? ""` goes, and
the `ReadSteeringFileDeps` doc comment defending it goes with it — that
reasoning is what shipped the bug. `src/ui/Router.ts#ReadSteeringFileRefusal`'s
reason union grows the same third member and keeps mapping non-`file-vanished`
reasons to `BAD_REQUEST`.

**The screens gain a read-error branch they do not have today.** `Plan.tsx`'s
`view === undefined && !isLoading` prints "Could not load the plan." for every
failure, and `Review.tsx` does the same — neither reads
`error.data.readRefusal.reason`. Both containers now read it and render one
named sentence per reason, sharing `Refusal.tsx#messageFor`'s existing style.
`head-unresolved` gets a message that does not offer a retry, because a retry
cannot help: **"Can't read this repository's current commit — editing is
disabled until that's fixed."**

**Silent retry is one pure function, not logic scattered across two screens.**
New `src/web/staleRetry.ts`:

    withStaleShaRetry<T>(
      attempt: (tokens: CasTokens) => Promise<T>,
      tokens: CasTokens,
      refetch: () => Promise<CasTokens>,
    ): Promise<T>

It calls `attempt(tokens)`; on rejection it reads the refusal through
`api.ts#writeRefusalFrom` and rethrows unless
`reason === "stale-token" && moved === "sha"`; then it awaits `refetch()` and
calls `attempt(fresh)` exactly once, literally — no loop, no recursion, no
second catch. **The retry can only ever fire on `moved: "sha"` and can only ever
fire once, because there is no code path in the function that reaches the second
call twice.** A `content-hash` refusal never triggers a refetch at all.

Wiring: `Plan.tsx#usePlanMutations` and `Review.tsx`'s equivalent hook each
route `writeNote`, `setValue` and `done` through it. `refetch` is
`utils.readSteeringFile.fetch({ filePath, mode })` — `fetch`, not `invalidate`,
because the retry needs the fresh tokens as a value. The existing
`onSettled: invalidate` stays; a `fetch` populates the same cache entry, so the
two do not fight.

**The banner gets a working control instead of the word "reload".**
`useRefusal.showRefusal(error, retry?)` stores an optional thunk alongside the
refusal state; `RefusalBanner` renders a `Try again` button when one is present,
clears the refusal when it resolves, and re-shows on rejection. The thunk is the
whole write path, so pressing it refetches tokens through `withStaleShaRetry`
again — never a replay against the tokens that already failed. `Dismiss` stays.
Both `stale-token` sentences drop "reload"; the `sha` one now describes a
refusal that already survived one silent retry.

**Risk:** `src/web/screens/Question.stories.tsx` lines 591, 622 and 697 pin the
old banner strings and get updated — the requirement pins that a genuine
`content-hash` change still shows the banner, not that the sentence is
byte-identical. Any package that changes the text and not those three assertions
reds `test:web`.

Acceptance, all mechanical:

- `src/ui/Beat.test.ts` builds a real repo and a real `git worktree add` in a
  tmpdir and expects `liveHeadSha(linked)` to equal `git rev-parse HEAD` there.
  No existing fixture covers a linked worktree. A second case runs
  `git pack-refs --all` first, covering the packed path through `commondir`.
- A `ReadSteeringFile` unit case: `headSha` dep resolving `undefined` yields
  `{ ok: false, reason: "head-unresolved" }`, never an `ok: true` with `""`.
- `src/web/staleRetry.test.ts` (unit project, same shape as `api.test.ts`): a
  `content-hash` refusal rethrows with `refetch` never called; a `sha` refusal
  refetches once and resolves; a second `sha` refusal rethrows.
- A `Plan.stories.tsx` story whose mocked `writeNote` refuses `moved: "sha"` on
  call one and accepts on call two, with `readSteeringFile` returning a new
  `headSha` in between: the write lands and no banner ever renders.
- `src/ui/Write.test.ts#353` is rewritten to assert the server still refuses a
  genuine sha move — the recovery is client-side, and the compare-and-swap on
  the server does not soften.

## Concern 2 — One-thumb layout and deliberate visual design

Merged; see `## Merged Concerns`. One token home, one control system, one pass
over every surface — restyling `Card.tsx`, `NoteSheet.tsx`, `Refusal.tsx` and
the four screens twice, once for size and once for colour, is two edits to the
same lines.

**One home: Tailwind CSS v4's `@theme`, in `src/web/styles.css`.** Tailwind is
the mechanism — utility classes at every call site, no `style={{ … }}` objects
left in the web tree. v4 is CSS-first, so the token home is an `@theme` block in
one stylesheet: `--color-*` (page, surface, border, text, muted, accent,
accent-pressed, disabled), `--text-*` (size + line-height pairs), and the
default 4px spacing scale kept as-is, which makes the 44px floor exactly
`min-h-11 min-w-11` — one utility, no literal to retype. Dark only; no `dark:`
variant, no `prefers-color-scheme` branch, no second palette. `@source "./"`
declares the scan root explicitly rather than relying on auto-detection.
`index.html`'s three hardcoded values move into the stylesheet's base layer;
`color-scheme: dark` stays.

**The CSS is built by the Tailwind CLI as its own step, never by tsdown.**
`npx @tailwindcss/cli -i src/web/styles.css -o dist/web/main.css` runs between
`tsdown --filter web` and the inline step in `npm run build`. tsdown's browser
config keeps a single JS entry and stays CSS-free — no PostCSS in rolldown, no
CSS import from `main.tsx`, no second emitted asset it has to reason about.
Storybook and the `test:web` browser project get the same stylesheet through
`@tailwindcss/vite` in `.storybook/main.ts`'s `viteFinal` plus an import of
`../src/web/styles.css` in `.storybook/preview.ts` — one source file, two
consumers, no duplicated palette.

**Risk, blunt: `gtd ui --dev` is a second, separate inlining path and it will
serve unstyled if only the packaged build is fixed.**
`Server.ts#resolveClientHtml`'s dev branch runs `npx tsdown --filter web`, reads
`dist/web/main.js`, and calls the shared `src/ui/scriptTag.mjs#inlineScript` —
it never touches `scripts/inline-web-client.mjs`. The CSS inlining therefore
lands in `scriptTag.mjs` as `STYLE_TAG_PATTERN` + `inlineStyles(template, css)`,
next to its `<\/script>` escaping sibling (a literal `</style>` in the CSS gets
the same guard), and the dev branch runs the Tailwind CLI too. Two call sites,
one module, or the phone looks right in Storybook and ships grey in `--dev`.

**Contrast is asserted against the shipped token values.**
`src/web/tokens.test.ts` (unit project, no browser) reads `src/web/styles.css`,
parses the `@theme` block's `--color-*` declarations, implements WCAG relative
luminance, and asserts every shipped pair: ≥4.5:1 for body text on its
background, ≥3:1 for large text and for every control boundary against its
surface. Parsing the real file, not a duplicated JS copy of the palette, is what
keeps the assertion honest. Ratios never get eyeballed.

**The anchored bar is a layout-chain change, not a `Deck.tsx` edit.** The screen
shell becomes a viewport-tall flex column — `h-dvh flex flex-col` on
`body`/`#root`/`App`'s wrapper — each screen owns exactly one scroll container
(`flex-1 min-h-0 overflow-auto`; `min-h-0` is mandatory, a flex child's default
`min-height: auto` refuses to shrink and the bar goes off-screen again), and the
deck's Back/progress/Next row is that container's `shrink-0` sibling. Nothing is
`position: fixed` or `sticky` — the bar is in flow, so it cannot overlay
content, and it is inside the viewport with zero page scroll because the column
is exactly viewport-tall. `interactive-widget=resizes-content` shrinking the
layout viewport shrinks the scroll area, and the bar rides up with it; nothing
new competes with `NoteSheet`'s sheet for the bottom of the screen. `Deck.tsx`'s
doc comment about never being absolutely positioned stays true and gets
rewritten to name the new guarantee.

**Risk, blunt: this breaks window-level scroll restoration in two places.**
`src/web/useScrollRestoration.ts` reads and writes `window.scrollY`, and
`Review.stories.tsx#282` and `Card.stories.tsx#121` both assert
`window.scrollY === 500` after a scroll. Once the page itself no longer scrolls,
`window.scrollY` is permanently 0 and the list silently loses its place on every
deck exit. The hook becomes element-based — `capture(el)` / `restore(el)`
against the screen's scroll container ref — and both stories move to that
element's `scrollTop`. A package that changes the layout without changing the
hook ships a working-looking regression that no assertion catches in its old
form.

**One control system replaces the per-call-site reset.** New
`src/web/Button.tsx`: `variant: "primary" | "secondary" | "ghost"`, always
`min-h-11 min-w-11`, and default/`active:`/`disabled:`/`focus-visible:` states
as real pseudo-class utilities — Tailwind's own reset makes the hand-written
`background: none`/`border: none`/`font: inherit`/`color: inherit` erasure
unnecessary, so it is deleted rather than centralised. Call sites that today
re-erase button chrome by hand stop doing that: `Card.tsx` (which also loses its
four duplicated `borderBottom*` longhands and gains `min-h-11`),
`NoteSheet.tsx#232`'s dismiss/save/mic trio, `Review.tsx#368` and
`Review.tsx#401`'s two adjacent chunk controls, and `Deck.tsx`'s Back/Next.

**The seven text-only states get one designed block.** `App.tsx`'s loading,
query-error, broken, moved-on and unrenderable branches are five
`<div style={{ padding: 16 }}>`s; concern 1 adds the read-refusal branch; the
`RefusalBanner` is the seventh. All route through one `Notice` component with a
tone (`info` / `error`), so a refusal reads visually distinct from the `Saved`
label sharing its live region rather than differing only by background hex.

**The build trap is now live, not hypothetical — Tailwind emits the asset the
inline step was blind to.** `scripts/inline-web-client.mjs` throws only on a
missing `<script>` tag and never looks at anything else in `dist/web/`. It now
inlines `dist/web/main.css` through `scriptTag.mjs#inlineStyles` AND throws when
that file is missing, empty, or when any emitted `dist/web/` asset is left
un-inlined. `tests/tooling/` gains a test pinning both throws: the served HTML
is one self-contained file with a non-empty `<style>`, or the build fails.
`turbo.json`'s `build` inputs already cover `scripts/**` and `src/**`; the new
tooling test rides `test:unit`'s own `tests/**`. `test:web` inputs still exclude
`src/web/generated.html`, which is correct — Storybook never reads it — and is
exactly why the tooling test, not `test:web`, is the gate here.

Acceptance runs in the browser at 390×844 through `npm run test:web`, with the
`page.viewport` + `getBoundingClientRect` pattern `Card.stories.tsx#141` and
`Plan.stories.tsx#250` already use:

- Every restyled control gets a `>= 44` assertion on both width and height.
- `Deck.stories.tsx#107`'s contract is rewritten: keep `compareDocumentPosition`
  and `controlsRect.top >= contentRect.bottom`, drop `position === "static"` as
  the stated contract, and add that the bar's box lies inside the 844px viewport
  with the document not page-scrollable.
- A short-viewport deck story at `page.viewport(390, 500)` — the stand-in for a
  keyboard-open layout that `NoteSheet.stories.tsx#141` already established —
  asserts the same two things.
- Every restyled control's default, pressed and disabled states get a story, so
  `npm run storybook` is a real judgement surface for the human at review.

## Merged Concerns

Concern 2 above merges the two redesign requirements. Their footprints are the
same files, not an interface and its consumer: both edit `Card.tsx`,
`NoteSheet.tsx`, `Refusal.tsx`, `App.tsx` and the four screens, and both write
into the same token home — one is sizes, the other colour and type, on the same
declarations. Both requirements are carried verbatim below so spec review still
covers each independently.

### PRODUCT — Make every control reachable and hittable with one thumb

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

### PRODUCT — Give the UI a deliberate visual design

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

## Answered Questions

### Does the ref fix keep `liveHeadSha` filesystem-only, or shell out to `git rev-parse`?

Filesystem-only. A subprocess per steering-file read is exactly what this
function's design avoids, and `commondir` is one more file read.

### What does an unresolvable HEAD look like to the client?

A third read refusal, `"head-unresolved"`, surfaced through the existing
`ReadSteeringFileRefusal` → `error.data.readRefusal.reason` path, rendered as a
sentence that offers no retry — a retry cannot fix a broken git layout.

### Where does the single silent retry live?

In one pure module, `src/web/staleRetry.ts`, consumed by both screens' mutation
hooks — duplicating the "sha only, once only" guard across `Plan.tsx` and
`Review.tsx` is how the second copy loses the cap.

### Is the anchored bar `position: fixed`, or a viewport-tall flex column?

A `100dvh` flex column with the content as the scrolling child. It keeps the bar
in normal flow (so it can never overlay content), keeps it on screen with no
page scroll, and moves correctly when `interactive-widget=resizes-content`
shrinks the viewport — all three of `Deck.stories.tsx`'s rewritten assertions
fall out of the layout rather than being defended against it.

### Do the two screens keep page-level scroll, or own a scroll container?

Each screen owns one scroll container, and `useScrollRestoration` becomes
element-based. A viewport-tall shell means `window.scrollY` is always 0, so the
hook and the two stories asserting it must move together or scroll restoration
dies silently.

### Does every control get its own styling, or one shared control component?

One `src/web/Button.tsx` with variants and states. Seven call sites currently
re-erase default button chrome by hand; a control system is what stops that, and
it is the only way default/pressed/disabled land consistently.

### What mechanism carries the design tokens — JS objects with inline styles, or a real stylesheet with CSS custom properties?

Neither: Tailwind CSS v4, with the palette and type scale in an `@theme` block
in `src/web/styles.css`, built by `@tailwindcss/cli` into `dist/web/main.css`
and inlined into the served HTML by both the packaged build and the `--dev`
path.
