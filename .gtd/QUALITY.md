## Free-form tick refuses a whole list when one task box is not on its item's marker line

`tickEdits` (`src/steering/freeform.ts`) finds each sibling's box by regex on
the item's START line (`toLspPosition(item.position.start).line`), and returns
`anchor-not-found` for the whole group as soon as any sibling's start line has
no `[ ]`/`[x]` — the check runs before the `continue` that skips untouched
unticked siblings.

GFM still parses a task item whose box sits on the line after a bare marker.
Verified with the same parser extensions:

```markdown
- [ ] a
- [ ] b
```

parses as two task items (`checked: false`, start lines 0 and 2). The phone
renders both boxes tappable, but ticking `b` (line 2) refuses: sibling `a`'s
start line is just `-`. Ticking `a` (start line 0) refuses too. The user sees a
failed save on a list the view presented as tickable.

Fix: take the box position from the item's first paragraph child's start (where
the parser recognised the checkbox) rather than the marker line, and only look
up a box for the siblings that actually get an edit. `freeform.test.ts` has no
case where the box is off the marker line.

## Phone-side tick wiring has no test that fails without it

The new unit tests in `freeform.test.ts` cover only `freeFormFormat.apply`.
Nothing checks the path this issue is about, the one that was broken: in
`FreeForm.tsx`, `TickContext.Provider` → `TaskBox.onChange` →
`setValue({ anchor: { kind: "paragraph", line }, checked: true })` → the
`writeValue` fallback to free-form for an unregistered `mode`.

Each of these changes would leave the suite green:

- dropping the provider, so every box is read-only again (the original bug)
- sending the group line instead of the item line
- keying the optimistic pick wrongly, so two boxes show ticked

No `Write.test.ts`/`Server.test.ts` case sends `checked` with an unregistered
mode, and no `@inmem` scenario ticks a box in a free-form file.

Add an `@inmem` scenario that ticks a box in an unregistered-mode file and
asserts the bytes on disk, plus a component/story assertion on the pick-one
optimistic state.

## No `@inmem` cucumber scenario for the new phone-side tick feature

AGENTS.md, Testing: "create cucumber.js scenarios for each new feature, tagged
`@inmem`." This change adds a user-visible feature (tickable, pick-one task
boxes in free-form `gtd ui`, described in the README edit) but touches no
`tests/integration/features/*.feature` file. Only `freeform.test.ts` unit cases
were added. Same rule also asks that Given steps expose file content in the
scenario text, so the scenario should show the markdown list before and after
the tick.

## "A pick never clears" keeps the free-form tick outside the format contract's round-trip test

Spec decision (REQUIREMENTS Concern 3): a free-form pick "only moves, never
clears". Built as `freeFormApply` refusing `checked: false` with
`anchor-not-found` (`src/steering/freeform.ts`).

Invariant it conflicts with: `src/steering/contract.test.ts`'s "round-trips
every tick" case, the pin `FORMATS.md` says every format's writer is held to.
For each ticked node it writes `checked: false` and requires the bytes to
change, then `checked: true` and requires the original bytes back. The spec's
own Impact section said "free-form now joins it". It can't: under this decision
the `off` write throws `off refused: anchor-not-found`.

So the change left free-form at `["free-form", freeFormFormat, false]` ("has no
ticks to read"). `view` still reports no `checked` on any free-form node, and
the screen reads box state from its own markdown render, not from the format's
read. As a result, the format's one new writer (a tick, which `FORMATS.md` lists
as a breaking-change surface) has no fixture or contract coverage. The contract
test still says free-form has no ticks, but the phone now writes them. The
refusal reason is also wrong: `anchor-not-found` for an anchor that resolves,
when the real refusal is a policy (the pick never clears).

Resolve it one of two ways:

- **Enforce never-clear in the client.** `TaskBox` already ignores a tap on a
  ticked box, so `apply` can support `checked: false`. Then expose `checked` on
  free-form task items, add a ticked `free-form/` fixture and flip the flag to
  `true`.
- **Keep the refusal in the format.** Add a dedicated reason for it and a
  free-form contract case pinning the pick-one write's byte-exact round trip.
