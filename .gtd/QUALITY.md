# Quality

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
