# Spec feedback: 03-client-opens-on-the-step

Three acceptance bullets have no test anywhere in the tree. Everything else in
the package checks out: `SteeringFormat.apply` and both built-in
implementations, `writeValue`/`setValue`/`writeRefusalFrom`, `App.tsx`'s
two-branch step render, the deleted fleet screen, the client write-throughs, and
the handed-back panel are all implemented and covered.

## The on-disk round trip is never asserted

Requirement acceptance: "a scenario answers a question in the UI and asserts the
answer is in the steering file on disk". Task 4 repeats it: "An answer given in
the UI is in the steering file on disk, asserted by a scenario".

No such scenario exists. `tests/integration/features/ui.feature` covers only
refusals; `ui-lifecycle.feature` covers signals, `done`, and `/close`.
`grep -rn setValue tests/` returns nothing — no step definition and no
`world.ts` helper drives a `setValue` mutation against a spawned `gtd ui`.

The two Storybook stories that exist —
`Plan.stories.tsx#RealContainerWriteThroughsAnAnswerViaSetValue` and
`Review.stories.tsx#RealContainerWriteThroughsAHunkTickViaSetValue` — record the
mutation's INPUT against a mocked resolver that returns `{ ok: true }` without
touching a file. They prove the client sends the right request; they prove
nothing about disk.

Needed: a `@live` scenario alongside `ui-lifecycle.feature`'s handoff case —
`world.ts` already has `spawnGtdUiAndHandOff` driving a real HTTPS tRPC round
trip against a real spawned server, so the missing piece is a sibling helper
that calls `setValue` and a `Then the file "PLAN.md" contains "[x]"`-style
assertion on the served worktree's own file.

## "An answer survives a page reload" is untested

Task 4's last bullet. No test remounts the client and asserts the answer is
still shown. The only match for `eload` under `src/web/` is a prose comment at
`Plan.tsx:20`.

## "A hunk tick survives a reload" is untested

Task 5's last bullet, and the requirement's own third acceptance clause. Same
gap: nothing remounts `Review` against a steering file whose bytes carry the
tick and asserts the tick renders.

Both reload bullets are reachable at the Storybook tier without a browser
reload: mount against a `readSteeringFile` resolver returning content/`view`
whose `checked` is already `true` (the state a real write leaves behind) and
assert the control reads as ticked with the local optimistic map empty. The
optimistic `answers`/`ticked` maps must NOT be what makes the assertion pass.
