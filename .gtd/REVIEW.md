# Review: 3686b03

<!-- base: f89b9f13412d541fa777d86877bdc1ac1c1cdb41 -->

Two packages landed together: **package 02** replaces every inline `style={{}}`
under `src/web/` with a Tailwind design system (tokens, `Button`, `Notice`, a
viewport-tall non-scrolling shell), and **task 01** adds in-place recovery for a
stale-sha write refusal plus a real `head-unresolved` read refusal.

- a hunks description is currently loaded into its "note" textbox, which is
  wrong. it should be displayed above the diff
- remove the dictate button. it is unnecessary and freezes the ui. users can
  dicate from the onscreen keyboard
- chunk summaries sometimes show the first hunks checkbox. if there is no
  description, it should show nothing
- remove the qr code. it has no purpose

## Tailwind build pipeline

A second build artifact — `dist/web/main.css` — now has to be produced and
folded into the single self-contained HTML file. Three consumers compile the
same `src/web/styles.css`: the packaged build (Tailwind CLI), `--dev` (shells
out to the same CLI), and Storybook/`test:web` (the Vite plugin).

- [ ] ./src/web/styles.css#1 — new stylesheet: `@import "tailwindcss"`, an
      `@theme` token block, and the `body` rules moved out of `index.html`
      Dark-only palette. `@source "./"` scans `src/web` for class usage.
- [ ] ./package.json#32 — `build` gains an `npx @tailwindcss/cli` step between
      the two tsdown builds
- [ ] ./src/ui/scriptTag.mjs#25 — `STYLE_TAG_PATTERN` / `inlineStyles`, the CSS
      twin of `inlineScript`, with the same `</style>`-escaping and
      replacement-function guards
- [ ] ./scripts/inline-web-client.mjs#17 — pure `buildGeneratedHtml` extracted
      so it can be unit-tested, guarded behind an
      `import.meta.url === file://${process.argv[1]}` main check Fails loudly on
      a missing or empty `main.css`, and on _any_ `dist/web/` asset it doesn't
      know to inline — a good guard against the next silently-dropped artifact.
- [ ] ./src/ui/Server.ts#294 — `rebuildDevClientCss`, the `--dev` sibling of
      `rebuildDevClientScript`
- [ ] ./.storybook/main.ts#12 — `viteFinal` adds `@tailwindcss/vite` so
      Storybook sees the identical palette
- [ ] ./src/web/index.html#22 — `body {}` rules removed,
      `<link rel="stylesheet" href="./main.css" />` added
- [ ] ./.fallowrc.json#31 — `ignoreUnresolvedImports: ["**/main.css"]` because
      that link points at a build-time artifact
- [ ] ./tests/tooling/inline-web-client.test.ts#1 — seven cases over
      `buildGeneratedHtml`, including the `</style>` injection escape

**Risk — under-declared turbo inputs cache a stale green.** `test:unit`'s
`inputs` array in `turbo.json` does not list `scripts/**`, but this new test
imports `scripts/inline-web-client.mjs` directly. Edit only that script and
`npm test` replays a cached pass. This is exactly the failure mode AGENTS.md
names by example (`docs/**` in `test:unit`). Add `scripts/**`.

## Design tokens, Button, Notice

- [ ] ./src/web/Button.tsx#1 — one control component, three variants,
      `min-h-11 min-w-11` (the 44px thumb floor) plus real
      `active:`/`disabled:`/`focus-visible:` utilities
- [ ] ./src/web/Notice.tsx#1 — one block for every text-only state;
      `tone="error"` is the only tone with a border The error tone is
      `border border-accent` on the same `bg-surface` as info — a **blue**
      border for errors, with no other differentiator. Distinct enough to assert
      on computed style; ask whether it reads as "something went wrong" to a
      human.
- [ ] ./src/web/tokens.test.ts#1 — parses the real `@theme` block out of
      `styles.css` and asserts every pair against WCAG AA (4.5:1 body, 3:1
      large/controls) No duplicated JS copy of the palette — the test re-reads
      the shipped source.
- [ ] ./src/web/testing/realMousePress.ts#1 — raw CDP `Input.dispatchMouseEvent`
      so `:active` actually applies; synthetic events never trigger it in
      Chromium The iframe coordinate transform (offset _and_ scale, walked up
      the frame chain) is the subtle part, and the comment explains why an
      offset alone silently mis-clicks far-from-origin controls.

## Every inline style converted to Tailwind

Mechanical, but wide. Worth a skim for lost behaviour rather than a line-by-line
read.

- [ ] ./src/web/Card.tsx#17 — thirteen inline properties → one class string;
      gains `min-h-11`
- [ ] ./src/web/NoteSheet.tsx#135 — sheet, textarea, footer and all four buttons
      converted
- [ ] ./src/web/screens/Hunk.tsx#28 — diff line backgrounds and syntax token
      colors become arbitrary-value classes (`bg-[#0d2818]`, `text-[#6a9955]`) —
      off-palette by design
- [ ] ./src/web/screens/Question.tsx#188 — option rows get `min-h-11` on the
      `<label>`, since native radio chrome can't be resized
- [ ] ./src/web/screens/Review.tsx#374 — chunk row: the bare checkbox is wrapped
      in a 44×44 `<label>`, and the hand-rolled `opacity`/`cursor` disabled
      styling is dropped for `Button`'s `disabled:text-disabled`
- [ ] ./src/web/App.tsx#33 — all five text-only states route through `Notice`

## Non-scrolling viewport shell

The page itself no longer scrolls; each screen owns its own `overflow-auto`
container. This is what makes the deck's control bar reachable without
`position: fixed`.

- [ ] ./src/web/App.tsx#73 — root becomes `h-dvh flex flex-col`
- [ ] ./src/web/Deck.tsx#72 — content is `flex-1 min-h-0 overflow-auto`,
      controls are its `shrink-0` sibling `min-h-0` is load-bearing; without it
      a flex child refuses to shrink below content and pushes the bar
      off-screen.
- [ ] ./src/web/useScrollRestoration.ts#20 — `capture`/`restore` now take a
      `RefObject` and read `scrollTop`, not `window.scrollY` `window.scrollY` is
      permanently 0 after the shell change, so this had to move. Ref rather than
      element because `restore` fires from the handler that remounts the list.
- [ ] ./src/web/screens/Plan.tsx#438 — plan list wrapped in its own scroll
      container
- [ ] ./src/web/screens/Review.tsx#430 — same for the chunk list, threaded down
      as a `scrollRef` prop
- [ ] ./src/web/Deck.stories.tsx#108 — the old `position: static` contract is
      dropped for geometric assertions (bar inside the viewport,
      `documentElement.scrollHeight <= viewport`), plus a 390×500 short-viewport
      story standing in for an open keyboard

## Stale-sha retry (task 01)

A write refused with `moved: "sha"` now refetches tokens and retries once,
silently, before the banner ever appears.

- [ ] ./src/web/staleRetry.ts#26 — `withStaleShaRetry`: one attempt, one
      refetch, one retry, no loop and no recursion
- [ ] ./src/web/screens/Plan.tsx#515 — `refetchTokens` uses
      `utils.readSteeringFile.fetch`, not `invalidate`, because the retry needs
      the tokens back as a value
- [ ] ./src/web/screens/Review.tsx#555 — the same, with `casTokensFor` collapsed
      to just the two token fields
- [ ] ./src/web/Refusal.tsx#98 — `onRetry` on the banner; a failed retry
      re-shows the same refusal with the same thunk still attached, so a second
      failure leaves the banner up
- [ ] ./src/web/Refusal.tsx#14 — every "reload to see the latest" sentence
      rewritten, since recovery is now in-page
- [ ] ./src/web/testing/TrpcTestProvider.tsx#36 — `TRPCClientError.from(error)`
      untouched instead of forced through `new Error(String(error))`, so a
      resolver can simulate a typed refusal; `retry: false` on the QueryClient
      so error stories don't race a 30s backoff

**Risk — the silent retry can overwrite a concurrent edit.** `Write.ts#160`
checks the sha _before_ the content hash. If both moved (someone committed _and_
the file content changed), the server reports `moved: "sha"`,
`withStaleShaRetry` refetches **both** tokens and replays the write — the
content-hash guard never fires, and the concurrent edit is clobbered with no
banner. `staleRetry.ts`'s own doc comment claims a content-hash refusal
"rethrows immediately, since retrying it would silently overwrite that edit";
that promise does not hold in the both-moved case. Fix options: refetch only
`expectedHeadSha` and keep the original `expectedContentHash`, or have the
server report both moved tokens.

**Risk — a successful retry does not restore the reverted optimistic state.** On
the first failure, `Plan.tsx#352` and `Review.tsx#167` delete the optimistic
note override. `onRetry` resolving only calls `dismiss()`. The write landed on
the server, but the note is gone from the screen until the next refetch. Same
for `setHunkChecked`/`toggleChunk`'s reverted ticks.

## head-unresolved read refusal

`readSteeringFile` no longer hands out an empty `headSha` string.

- [ ] ./src/ui/ReadSteeringFile.ts#65 — an undefined `headSha` is now a typed
      `head-unresolved` refusal, replacing the `?? ""` fallback
- [ ] ./src/ui/Beat.ts#324 — `commonGitDir`: a linked worktree's gitdir has no
      `refs/` and no `packed-refs`, both live in the directory named by
      `commondir` This is the actual root cause — `liveHeadSha` returned
      `undefined` in every linked worktree, which is how the empty-string
      fallback got exercised at all.
- [ ] ./src/ui/Beat.test.ts#277 — real-git tests over loose ref, packed-refs,
      and detached HEAD in a linked worktree, plus a "spawns no subprocess"
      assertion
- [ ] ./src/web/api.ts#51 — `readRefusalFrom`, mirroring `writeRefusalFrom`
- [ ] ./src/web/Refusal.tsx#42 — `messageForReadRefusal`: one named sentence per
      read-refusal reason
- [ ] ./src/web/screens/Plan.tsx#321 — the "no view yet" branch renders the
      named sentence instead of the generic fallback
- [ ] ./src/web/screens/Review.tsx#462 — the same for `Review`
- [ ] ./src/ui/Router.ts#46 — the refusal union widened; `Router.test.ts#298`
      pins the `BAD_REQUEST` code

**Risk — a repo with no commits now blocks the whole screen.** The deleted doc
comment on `ReadSteeringFileDeps` explicitly named "a fresh worktree with no
commits yet" as a real case that was carried through as `""` rather than failing
the read. That case now hits `head-unresolved` and renders "editing is disabled
until that's fixed" with no way forward. If it is genuinely unreachable in gtd's
flow, say so in a comment or a test; right now the change silently reclassifies
it.

## Story coverage

Almost all additive, and the assertions are geometry and computed style rather
than class names — good.

- [ ] ./src/web/Button.stories.tsx#1 — nine stories: default/pressed/disabled
      per variant, exact rgb values, 44px floor
- [ ] ./src/web/screens/Plan.stories.tsx#1 — `head-unresolved` with no retry
      control, `file-vanished` by name, in-place recovery, Try-again-succeeds,
      Try-again-fails-twice, and refusal-vs-Saved visual distinction
- [ ] ./src/web/screens/Review.stories.tsx#1 — the same set for `Review`, plus
      pressed/disabled stories for both chunk controls
- [ ] ./src/web/App.stories.tsx#100 — the `query.isError` state, never exercised
      before
- [ ] ./src/web/Card.stories.tsx#109 — 44px floor and pressed state for `Card`,
      the one control not routed through `Button`
- [ ] ./src/web/screens/Hunk.stories.tsx#1 — 44px floor for the note affordance
      and the tick row's label
- [ ] ./src/web/NoteSheet.stories.tsx#1 — footer controls at the 44px floor
- [ ] ./package-lock.json#1 — 964 added lines for the three Tailwind packages;
      nothing to read
