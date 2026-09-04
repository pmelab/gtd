# Spec feedback — 02 Worktree discovery and the fleet screen

## 1. The version gate reads the scanned project's version, not gtd's — most worktrees become Broken

`src/serve/Beat.ts:263` calls `deps.readPackageVersion(worktree.path)`, wired in
`src/serve/Server.ts:289` to `readPackageVersionAt`, which reads
`<worktree>/package.json`'s own `version` field (`src/serve/Beat.ts:358-366`).
That is the SCANNED PROJECT's version, not the version of the `gtd` that would
run there. This checkout's major is 10 (`package.json` version `10.5.0`), so any
scanned JS project at `1.2.3`, `0.1.0`, `2.0.0`, … short-circuits at
`src/serve/Beat.ts:264` into `unsupported gtd version: 1.2.3` and never even
spawns `gtd next --json`.

Breaks two acceptance criteria directly:

- T4 "every worktree found is listed, including ones with no gtd process"
- T5 "a worktree with no gtd config renders as a normal row with a message kind,
  not as Broken"

The version that must be range-checked is the gtd resolvable in that worktree
(e.g. its `node_modules/@pmelab/gtd/package.json`, or the version the beat
itself reports), never the host project's. `src/serve/Beat.test.ts:175` passes
only because its fake returns `999.0.0` for a hypothetical gtd — no test uses a
non-gtd project's package.json, which is the actual production case.

## 2. `FleetView` is never mounted — the fleet screen does not exist in the served app

`src/web/App.tsx` is still the placeholder `<div id="gtd-app">gtd</div>`.
Nothing in `src/web/` calls `trpc.fleet.useQuery()`; a repo-wide grep shows
`FleetView` referenced only by `src/web/screens/Fleet.stories.tsx`. The `fleet`
tRPC procedure (`src/serve/Router.ts:86`) has no client caller.

So the requirement's "the fleet screen is the first thing the phone loads" is
unimplemented, and these T4/T6 criteria are unmet in the shipped app:

- "pull-to-refresh re-requests and re-renders" — the story only asserts an
  `fn()` spy fires (`Fleet.stories.tsx:154`); no request is ever re-issued
- "the document title carries the Wants-you count and updates when it changes" —
  the `useEffect` at `src/web/screens/Fleet.tsx:160-163` never runs outside a
  story, and NO test or story asserts `document.title` at all

T6 lists `src/web/api.ts` and `src/serve/Router.ts` among its paths; the wiring
that joins them to `Fleet.tsx` is missing.

## 3. "renders correctly at 390 px wide" is unverified

No story sets a viewport and `.storybook/preview.ts` declares none. A
`maxWidth: 390` in `src/web/screens/Fleet.tsx:178` is not the criterion — the
criterion is that the screen renders correctly AT that width, which nothing
exercises.

## 4. `NoLabelFallsBackToStateName` does not test the fallback

`src/web/screens/Fleet.stories.tsx:126-138` names the no-label criterion but
passes `label: "idle"` — a present label. The story asserts a label renders,
nothing more. The real fallback lives server-side (`src/serve/Beat.ts:240`) and
IS covered by `src/serve/Beat.test.ts:128`; either delete the misleading story
or make it exercise a row whose label is genuinely absent.

## 5. `BeatCache.withSlot` can exceed its concurrency cap

`src/serve/Beat.ts:311-323`: a waiter resumed from `queue` does `active++` AFTER
its await, and the releaser does `active--` BEFORE resolving that waiter. A
`read` arriving in that window sees `active < concurrency`, takes a slot, and
the resumed waiter then pushes `active` past the cap — one extra live
`gtd next --json` per pending waiter. Reachable whenever two fleet requests
overlap (a phone refresh during a cold load), which is exactly the situation
T3's "never has more than that many child processes alive at once" guards.
`src/serve/Beat.test.ts:278` only drives a single `Promise.all` burst, so it
never observes the overshoot. Fix shape: re-check the counter after resuming, or
increment before resolving the waiter.
