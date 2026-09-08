# The client opens on the step and writes every input through

## Requirement

### The client entry becomes the current step

TECHNICAL. The app opens on the fleet list and navigates into a worktree. It
must **open directly on the step's own screen** for the one worktree being
served, with the handoff action reachable from there. The escape hatch back to
the fleet has nowhere to go; `src/web/screens/Fleet.tsx` and its stories go with
it. The mode-shaped screens — Plan, Review, Question, Hunk — are the part of the
client the rescope keeps.

Two review-confirmed wiring gaps live in exactly this area and a rescope does
not excuse them: **question answers are held in React state and never written to
the server**, and **hunk ticks are local-only**. Neither has anything to do with
fleet scope. Both must round-trip to disk through the surviving write path, or
the human's answers vanish when the server exits — which, after the handoff
concern, is every single step.

Storybook and the turbo task wiring follow the client's file layout if it moves.
The two-bundle build, the inlined HTML client, and the browser test tier are
independent of scope and survive untouched.

Acceptance: a browser test mounts the app at `/` and lands on the step screen
with no fleet route reachable; a scenario answers a question in the UI and
asserts the answer is in the steering file on disk; a hunk tick survives a
reload.

## Tasks

### Give the format contract a way to write a checkbox

`src/SteeringFormat.ts`, `src/OpenQuestions.ts`, `src/ReviewDoc.ts`

- [ ] `SteeringFormat` grows a mandatory
      `apply(content, anchor, { checked?, text? })` member returning
      `annotate`'s own result shape — edits, or a typed refusal
- [ ] `QA_FORMAT.apply` on an `option` anchor enforces **radio**: it ticks the
      target and unticks every sibling option of that question
- [ ] `QA_FORMAT.apply` with `{ checked: true, text }` on the free-text slot
      ticks it and replaces its label in **one** edit set
- [ ] `REVIEW_FORMAT.apply` on a `hunk` anchor sets that hunk's tick
- [ ] `REVIEW_FORMAT.apply` on a `chunk` anchor sets the tick on every hunk
      beneath it, at any depth
- [ ] An anchor a format cannot apply at returns `anchor-not-found`, exactly as
      `annotate` does
- [ ] `src/SteeringFormats.test.ts` asserts every registered format declares
      `apply`

### Add the compare-and-swap write for a value

`src/ui/Write.ts`, `src/ui/Router.ts`, `src/web/api.ts`

- [ ] `writeValue` mirrors `writeNote`: fresh `headSha`, fresh actor rest gate,
      content-hash compare-and-swap, splice through `applySteeringEdits`
- [ ] `WriteRefusalReason` gains no new values
- [ ] A `setValue` mutation exposes it, taking no `worktreePath`
- [ ] A stale `expectedHeadSha` or `expectedContentHash` refuses with
      `stale-token` and the `moved` field set
- [ ] A worktree not resting with a human refuses with `not-resting`
- [ ] `api.ts#writeRefusalFrom` reads a `setValue` refusal unchanged

### Open the app on the step, with no fleet

`src/web/App.tsx`, `src/web/screens/Fleet.tsx`

- [ ] `App.tsx` holds no navigation state and calls `trpc.step.useQuery()`
- [ ] A step whose `mode` is `review` renders `Review`; any other steering mode
      renders `Plan`
- [ ] There is **no third branch** — the server never binds on a step with no
      screen, so an unrenderable step is unreachable, not handled
- [ ] `screens/Fleet.tsx`, `Fleet.stories.tsx` and the "← Fleet" button are
      deleted
- [ ] A browser test mounts the app at `/` and lands on the step screen with no
      fleet route reachable

### Write question answers through to disk

`src/web/screens/Plan.tsx`, `src/web/screens/Question.tsx`

- [ ] Selecting an option calls `setValue.mutateAsync` and invalidates
      `readSteeringFile`
- [ ] Committing free text calls `setValue.mutateAsync` with both `checked` and
      `text` in one call
- [ ] The controlled `QuestionAnswer` state keeps its shape and its functional
      updater, and stays for tap responsiveness only
- [ ] The "not wired to writeNote, a later package" comment is gone
- [ ] An answer given in the UI is in the steering file on disk, asserted by a
      scenario
- [ ] An answer survives a page reload

### Write hunk and chunk ticks through to disk

`src/web/screens/Review.tsx`, `src/web/screens/Hunk.tsx`

- [ ] Ticking a hunk calls `setValue.mutateAsync` and invalidates
      `readSteeringFile`
- [ ] Ticking a chunk's check-all calls `setValue.mutateAsync` once with the
      chunk anchor, never one call per hunk
- [ ] The `ticked` map in `useReviewState` keeps its shape and stays for tap
      responsiveness only
- [ ] The "not wired to writeNote, a later package" comments are gone
- [ ] A hunk tick survives a page reload

### Show the human that the turn was handed back

`src/web/screens/Plan.tsx`, `src/web/screens/Review.tsx`

- [ ] After `done` resolves, the client renders a terminal "handed back" panel
- [ ] The panel needs no further server round trip — the socket dies moments
      later
- [ ] No screen offers a way back to a list

### Follow the client layout in Storybook and keep the tiers green

`src/web/testing/TrpcTestProvider.tsx`, `.storybook/`

- [ ] `Fleet.stories.tsx` is deleted
- [ ] Surviving stories' mock link answers `step` and `setValue`
- [ ] `npm run test:web` passes
- [ ] `turbo.json` needs no edit — `test:web`'s `inputs` are `src/**` and
      `.storybook/**`
- [ ] `npm test` is green
