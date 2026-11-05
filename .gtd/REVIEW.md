# Review: 235903b

<!-- base: e49e45dad6cb75b11620a7ab115cd89c89d11717 -->

**Free-form steering files now take task-box ticks from the phone.** Each list
is pick-one: ticking moves the single tick within that list. Clearing a tick is
refused. No defect found.

## Scenarios

- [ ] ./tests/integration/features/ui.feature#318-345 — **A tick in a mode-less
      file moves the pick on disk.** A file with `- [x] APPROVE` /
      `- [ ] REJECT` gets ticked on line 3 through a spawned `gtd ui`.
      Afterwards APPROVE is unticked and REJECT ticked.
- [ ] ./tests/integration/support/steps/ui-lifecycle.steps.ts#317-327 — new step
      `I tick the box on line N of FILE via a spawned gtd ui`: sends
      `checked: true` at a `paragraph` anchor.

## Pick-one tick in the free-form format

**`apply` with `checked: true` now ticks a box instead of appending.** Steps:

- Find the list whose task item starts on the anchor line.
- Tick that item.
- Untick its ticked siblings, all in one edit set.

Each edit touches only the one character inside `[ ]`. **`checked: false`
refuses with the new reason `pick-never-clears`.**

- [ ] ./src/steering/freeform.ts#97-130 — groups task items per list (direct
      children only, so nested lists form their own groups). The box is found on
      the first child's line, which handles a bare `-` marker with `[ ]` on the
      next line. Ticking an already-ticked box returns an empty edit set.
      **Inside a fenced code block, a line yields no list group, so the tick
      refuses `anchor-not-found`.**
- [ ] ./src/steering/freeform.ts#141-145 — routes `checked` before the append
      path. **The doc comment above still says the function "only ever
      APPENDS"**; it is now stale and should mention the tick.
- [ ] ./src/steering/SteeringFormat.ts#77-83 — adds `pick-never-clears` to the
      refusal union.
- [ ] ./src/ui/Write.ts#189-195 — `annotateRefusal` now derives its parameter
      type from `SteeringFormat`. **`pick-never-clears` maps to
      `anchor-unresolved`**, so the phone shows the generic refusal.
- [ ] ./src/steering/freeform.test.ts#313-361 — unit tests cover:
  - single tick, with the rest of the file byte-identical
  - pick moving within one list only, while nested and sibling lists stay
    untouched
  - bare-marker box
  - ordered list with CRLF line endings
  - re-tick of a ticked box is a no-op
  - fenced box refuses
  - clear refuses
  - tick round-trips byte-exact
- [ ] ./src/steering/freeform.test.ts#234-238 — an existing note test switches
      to `applyEditsExact`.

## Phone UI: tappable boxes

**`FreeFormView` hands tick wiring to `ProseBlocks` through a new
`TickContext`.** Without the context, as on every other screen, boxes stay
read-only.

The optimistic pick lives in the write store, keyed by the line of the list's
first task item.

- [ ] ./src/web/screens/ProseBlock.tsx#14-54 — `TaskBox` + `useGroupPick`: a box
      shows ticked when it is the group's optimistic pick, or when it is checked
      on disk and no pick is pending. **Tapping a ticked box does nothing**
      (matches `pick-never-clears`). **The overlay entry is kept after a
      successful write and dropped only on failure.** If the file is rewritten
      on disk while the page stays open, the stale pick keeps overriding the
      on-disk state for that group line. Other write-store cells behave the same
      way.
- [ ] ./src/web/screens/ProseBlock.tsx#65-71 — list items render `TaskBox`
      instead of a fixed read-only input.
- [ ] ./src/web/screens/FreeForm.tsx#162-201 — `tickWiring` reads and saves the
      `tick` cell per group and wraps `ProseBlocks` in the provider only when
      `onTick` is wired.
- [ ] ./src/web/screens/FreeForm.tsx#254-276 — `onTick` mutation sends
      `{anchor: paragraph line, checked: true}` through `setValue` with CAS
      tokens (compare-and-swap guards against stale writes).
- [ ] ./src/web/screens/FreeForm.tsx#294-316 — threads `onTick` from the
      mutations hook into the view.

## Docs

- [ ] ./README.md#436-455 — `gtd ui` paragraph now mentions tickable task-list
      boxes, pick-one per list, and that a ticked box can't be cleared from the
      phone. The rest is reflow.
