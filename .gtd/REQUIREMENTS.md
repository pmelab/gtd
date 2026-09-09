# Requirements

## PRODUCT — Answering a question must not refuse with "someone else committed"

Answering a question on the phone refuses. The banner reads "Someone else
committed a change underneath you — reload to see the latest before trying
again." That sentence is `src/web/Refusal.tsx#13`, reachable only from
`reason: "stale-token"` with `moved: "sha"`. Nobody committed anything: the
process stopped at a human gate, the ui was started, nothing else was running.

**Root cause, proven by running it: `liveHeadSha` (`src/ui/Beat.ts#332`) returns
`undefined` in every linked worktree.** In this worktree `.git` is a file
pointing at `…/gtd/.git/worktrees/feat-phone-web-ui`, so `worktreeGitDir`
resolves there. That directory's `HEAD` is `ref: refs/heads/feat/phone-web-ui`,
and both fallbacks miss: `join(gitDir, "refs/heads/feat/phone-web-ui")` does not
exist — a linked worktree's gitdir carries no `refs/` tree, branch refs live in
the common directory named by its `commondir` file — and `packed-refs` does not
exist there either, so the `.catch(() => "")` yields an empty string with no
match. `git rev-parse HEAD` in the same directory returns
`db9e813850a8f6d06cdbe921971cb513f0194c06` without trouble.

**That `undefined` becomes a token that can never match.**
`src/ui/ReadSteeringFile.ts#61` coerces it to `""` (`?? ""`) and hands `""` to
the client; `src/ui/Write.ts#159` compares the raw `string | undefined` against
it, and `undefined !== ""` refuses. Every write behind `verifyForWrite` —
`writeNote`, `setValue`, `done` — refuses with `moved: "sha"`, on the first
attempt, forever, with no commit by anyone. **The phone is unusable in any
linked worktree, which is how this repository is worked on.**

The fix is two changes, both required:

- Resolve the ref through the common directory: keep reading `HEAD` from the
  per-worktree gitdir (it is per-worktree, correctly), but resolve
  `refs/heads/*` and `packed-refs` against the path in `commondir`. A bare
  40-hex detached `HEAD` keeps working as it does today.
- Delete the `?? ""` asymmetry. An unresolvable sha must refuse the READ with a
  named reason, never hand out a token no write can ever match. The current doc
  comment on `ReadSteeringFileDeps` argues the opposite — that a mismatch is "a
  normal, already-handled `stale-token` refusal either way" — and that reasoning
  is what shipped this bug; it goes with the code.

**HEAD stays in the compare-and-swap token, and the client recovers in place.**
On `moved: "sha"` the client refetches `readSteeringFile` and retries the write
once, silently; the banner appears only when that retry also refuses. A write
may therefore land one commit later than the human saw it, which is accepted.

Risk: **the retry must fire on `moved: "sha"` only, never on
`moved: "content-hash"`, and never more than once.** Retrying a content-hash
refusal silently overwrites an edit someone else made to the same file, and an
uncapped retry turns two clients writing the same file into a loop.

**Acceptance**: a test that builds a real linked worktree (`git worktree add`)
and expects `liveHeadSha` to equal `git rev-parse HEAD` there — it fails today,
and no existing fixture covers a linked worktree at all. Then a test that moves
HEAD with an unrelated commit between render and write and expects the write to
land through the single silent retry. `src/ui/Write.test.ts#353` asserts today's
`stale-token`/`moved: "sha"` refusal and gets rewritten.
`src/web/screens/Question.stories.tsx` lines 591, 622 and 697 pin the banner
text — it must still appear for a genuine content-hash change.

This concern is first. It is a total functional failure, and the two redesign
concerns below edit the same screens.

## PRODUCT — Make every control reachable and hittable with one thumb

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

## PRODUCT — Give the UI a deliberate visual design

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

### Does the redesign ship a light theme, or stay dark-only?

Dark-only. `color-scheme: dark` stays and no `prefers-color-scheme` branch is
added — one palette to design, one set of contrast ratios to prove.

### Does the anchored bottom bar carry each screen's primary action, or only the deck's Back/Next?

Only the deck's. `Deck.tsx`'s Back/progress/Next row becomes the anchored bar;
`Review`'s hand-back, `NoteSheet`'s save and the chunk-level controls stay in
flow, sized to the 44px floor.

### What is the minimum hit-target size — 44px or 48px?

44×44 CSS px. Apple's HIG figure, and the target device is iOS (the `serverAuth`
certificate constraint in this branch's history is an iOS constraint);
`Plan.stories.tsx#250` already asserts `>= 44` on the note seam, so 44 is
already this repository's floor and a second number would contradict it.

### Is "one home for styling" its own concern, ahead of the two visual ones?

No — merged into the thumb concern. A token module with nothing restyled through
it is pure preparation: it has no acceptance check that fails before and passes
after, and no independent value. It lands with its first consumer.

### How does the redesign get verified — on a real phone, or in CI?

In CI, then on a phone. The storybook-vitest browser project already drives real
viewports (`page.viewport`) and real geometry (`getBoundingClientRect`), so
every sizing and reachability claim becomes an assertion. Taste is the human's
call at review; geometry is not.

### Does the aesthetic direction change, or stay near-black dark with one accent?

Stays near-black dark with a single accent hue, refined rather than replaced —
it matches the existing `color-scheme: dark` and is the smallest change that
still answers "make it prettier".

### Does the refusal banner get an in-page recovery control instead of the word "reload"?

Yes. HEAD stays in the token, so the banner survives as a real state — and a
human told to reload on a phone loses their place in a deck. The banner gets a
control that refetches and retries in place.

### When HEAD moves under an open page, should the write still refuse?

Keep HEAD in the token and recover in place: on `moved: "sha"` the client
refetches the token and retries the write once, silently, showing the banner
only when that retry also refuses or when the file's own bytes changed. A write
may land one commit later than the human saw it.

### Did a concurrent commit cause the refusal the human hit?

No. The process stopped at a human gate with nothing else running, which ruled
out the loop-commit theory and pointed at the read itself: `liveHeadSha` returns
`undefined` in a linked worktree, and `readSteeringFile`'s `?? ""` turns that
into a token no write can match.
