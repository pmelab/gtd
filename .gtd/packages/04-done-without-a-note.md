# 04 — The design-document Q&A view can end the turn without a note

## Requirement

Ending currently requires opening the note sheet and writing something, because
`Save & Done` (`src/web/NoteSheet.tsx#191`) is the only affordance wired to
`trpc.done`. A human who has answered every question and has no note to leave
has no way out of the deck.

The button ends the TURN, not the process: the same handoff `Save & Done`
already performs, minus the mandatory note, reachable straight from the Q&A
deck. The driver decides what happens next. Nothing here rewinds or abandons
anything.

Reuse the existing `done` round trip (`src/ui/Router.ts#282`) and the
`HandedBackPanel` that follows it rather than inventing a second path.

## Task 1 — `done` accepts an optional note instead of a mandatory one

`done`'s input (`src/ui/Router.ts#282`, over `writeNoteInput` at `#124`) becomes
`{ note?: <today's writeNoteInput fields> }` — one optional nested object,
validated by the existing `writeNoteInput` when present, rather than six
independently-optional flat fields that can arrive in half-valid combinations.

`note` present → today's exact behaviour: write, refuse with the same
`WriteNoteRefusal`-carrying `CONFLICT` error on a failed write, then
`ctx.handOff()`. `note` absent → no write at all, straight to `ctx.handOff()`;
there is nothing to compare-and-swap, so no tokens are required.

The client is bundled with the server, so the nested shape needs no
compatibility shim. `writeNote` and `setValue` keep their flat inputs unchanged.

Paths: `src/ui/Router.ts`, `src/ui/Router.test.ts`.

- [ ] `done` with a `note` writes it and hands off — the existing behaviour,
      asserted unchanged, refusal path included
- [ ] `done` with no `note` performs no write at all and still hands off
- [ ] `done` with a malformed `note` (a missing string field, a bad anchor)
      throws before anything is written and before `handOff` is scheduled
- [ ] `writeNote` and `setValue` inputs are unchanged

## Task 2 — A Done control on the Q&A deck, with no label collision

`Deck` (`src/web/Deck.tsx#54`) gains one optional prop pair, `onDone` plus its
label. When given, `DeckControls` (`#22`) appends a primary "Done" button, and
its advance button's last-item label reverts from "Done" to "Back to list"
(`#39`) — two buttons both reading "Done" on one screen is the collision this
avoids. `Review.tsx`'s hunk deck passes nothing and is entirely unchanged,
last-item "Done" included.

`PlanView` gains `onDone?: () => Promise<unknown>` and passes it to its `Deck`
(`src/web/screens/Plan.tsx#413`). `Plan`'s `usePlanMutations` grows `onDone`
alongside `onDoneNote`, calling `done.mutateAsync({})` with the same
`.catch(onRefusal)` — fire-and-forget, never rethrown, for the same reason
`onDoneNote` isn't. `done.isSuccess` already drives `HandedBackPanel`, so the
terminal screen needs no new wiring.

Paths: `src/web/Deck.tsx`, `src/web/Deck.stories.tsx`,
`src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`,
`tests/integration/features/ui-lifecycle.feature`.

- [ ] a story taps Done from the question deck with no note written and asserts
      the handed-back panel renders
- [ ] the Q&A deck's last item shows "Back to list" on its advance button and a
      separate "Done" button; tapping "Back to list" returns to the question
      list and writes nothing
- [ ] the review deck renders exactly one control row, with "Done" as its
      last-item advance label and no second Done button
- [ ] a refused `done` shows the refusal banner and does not render the
      handed-back panel
- [ ] a cucumber scenario taps Done with no note and asserts the process exits
      the same way the existing handoff scenario does
- [ ] `npm test` green
