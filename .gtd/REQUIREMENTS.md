# gtd ui: tick a box in a mode-less steering file (pmelab/gtd#565)

## Open Questions

### Does tapping the box that is already ticked untick it?

With pick-one lists, a tap on an unticked box moves the tick there. A tap on the
ticked box either clears the list or does nothing.

- [ ] It unticks — the list goes back to no tick
  - a wrong pick can be withdrawn from the phone
  - a stray double-tap clears the pick; the workflow's gate then refuses zero
    ticks
- [ ] It does nothing — like a radio button, a pick can only move, never clear
  - no accidental clearing
  - zero ticks reachable only by editing the file by hand
- [ ] _your answer_

## Concerns

### 1. Free-form checkboxes are read-only (PRODUCT, the bug)

`.gtd/PR-CONFIRM.md` at prReview's `confirm.gate` names no mode, so `gtd ui`
opens it on the free-form screen. That screen draws every task-list box as a
read-only checkbox, and the free-form format accepts only one write: append text
at the end of the file. No box is tickable — pre-ticked or not.

The issue's guess (the "exactly one" group moves a tick but cannot set the
first) is wrong. REVIEW.md works because it opens on the review screen, which
has real radios; that screen already handles zero ticks. Fix the free-form
screen and format: tapping a box in any mode-less or unrecognised-mode file
flips that box in the file on disk.

### 2. A tick goes through the normal write path (TECHNICAL)

A free-form tick must ride the same guarded write as every other phone write:
the rest gate, the stale-content refusal and retry, the optimistic overlay with
rollback, the save indicator, and `ui.format` afterwards. How the anchor names a
list item (line-based) is the builder's call.

### 3. Every task list is pick-one (PRODUCT, decided)

On the free-form screen, ticking a box unticks every other box in the same list.
"Same list" means the direct sibling items of one list; a nested list is its own
separate group, and its parent's tick is untouched. Plain items without a box
are not part of the group.

Risk: **any free-form checklist meant to hold several ticks (a TODO list on a
mode-less file) can no longer collect more than one tick per list from the
phone** — the human chose this trade-off.

### 4. Every nesting depth and both list kinds (PRODUCT, decided)

A box in a nested item, or in an ordered list, is tickable like a top-level one.
Boxes inside a code fence are not list items and stay plain text.

## Acceptance Criteria

- AC-1: In `gtd ui`, a steering file opened with no mode (or an unregistered
  mode) shows each task-list item's checkbox as tappable; tapping an unticked
  box rewrites that item's `- [ ]` to `- [x]` in the file on disk.
- AC-2: On a file shaped like PR-CONFIRM.md (a "Tick exactly one event:" list of
  three unticked boxes, none pre-ticked), tapping `APPROVE` leaves the file with
  exactly `- [x] APPROVE` ticked and every other line byte-identical.
- AC-3: Ticking a box in a free-form file that also holds footnote threads,
  other lists and CRLF or LF line endings writes back the original text
  character for character, with the box marks of the tapped list set to the new
  pick.
- AC-4: A checkbox in a nested list item, and one in an ordered-list item, ticks
  in the file the same way a top-level one does.
- AC-6: After a free-form tick lands, the screen re-reads the file and shows the
  box in its new state; reloading the page shows the same state.
- AC-7: On the free-form screen, tapping an unticked box in a list that already
  has a ticked box rewrites the new one to `- [x]` and every previously ticked
  sibling in that same list to `- [ ]`, in one write; the screen shows only the
  new box ticked.
- AC-8: Ticking a box in a nested list leaves the ticks of its parent list and
  of every other list in the file unchanged, and ticking a box in a parent list
  leaves the ticks in its nested lists unchanged.

## Impact

- `src/steering` (boundary): the free-form format's `apply` gains a checkbox
  write for a list item that also unticks its siblings in the same list; today
  it only appends and refuses every other anchor. Its `view` may need to expose
  an anchor per task item. The steering contract test (`contract.test.ts`)
  round-trips `checked` on every node that reports one — free-form now joins it.
- `src/web` (boundary): the free-form screen and its prose-block list renderer
  turn read-only checkboxes into controls wired to the write store, plus a
  `setValue` mutation carrying `checked`.
- `src/ui` (boundary): `setValue`/`writeValue` already forward `checked` to the
  format; the server path needs no new route, but its free-form refusals change.
- `src/ui/client.generated.html`: the bundled phone client is regenerated with
  the screen change.
- Public surface: `gtd ui` behaviour only — no CLI flag, config key,
  driver-protocol field or exported API changes.
- `README.md`: the `gtd ui` paragraph says a mode-less file opens as "read, plus
  a note on any block"; it must add that task-list boxes are tickable and each
  list is pick-one.
- Tests: `@inmem` cucumber scenario(s) in
  `tests/integration/features/ui.feature`, plus web screen and steering unit
  tests.
- Surprise: the bug is not in "exactly one" groups at all; every box on the
  free-form screen is dead. The real long-term fix for PR-CONFIRM.md may also be
  giving `confirm.gate` a mode in pmelab/gtd-workflows — out of this repository.

## Already In Place

- The review screen (`src/web/screens/Review.tsx`, via `Question.tsx`'s radios)
  already ticks a box in a group with nothing pre-ticked: zero ticks seed "no
  selection" and a tap writes `checked: true`. It must keep working as is.
- `src/ui/Write.ts` writes every checkbox value through the format's `apply`,
  re-checking the rest gate and refusing on a stale head SHA or content hash;
  the free-form tick must go through it, not around it.
- `src/web/writeStore.ts` serialises writes per file, shows the value
  optimistically, rolls it back on refusal, and retries once with fresh CAS
  tokens (`staleRetry.ts`); the free-form tick must use it.
- `src/web/App.tsx` routes any absent or unregistered mode to the free-form
  screen and shows "has no screen — editing as plain markdown" for an
  unregistered one; that routing stays.
- Free-form notes (footnote threads on any block) and the empty-document append
  in `src/steering/freeform.ts` keep working as they are.
- `ui.format` runs after every landed write and shows a format notice; a
  free-form tick gets it too.
- `src/ui/Write.ts` refuses a write whose head SHA or content hash went stale
  since the screen read the file, leaving the file unchanged, and the write
  store rolls the box back; a free-form tick inherits this, no new code.
- prReview's `confirm` step (pmelab/gtd-workflows) refuses unless exactly one
  event is ticked — the guard against two ticks already exists downstream.

## Answered Questions

### Does a box at any nesting depth, or in an ordered list, get ticked too?

Yes — a markdown task item is the same thing at any depth; leaving some dead
would repeat this bug.

### Does this change give PR-CONFIRM.md its own mode or screen?

No — the workflow lives in pmelab/gtd-workflows; gtd's fix makes every mode-less
checkbox work, which covers PR-CONFIRM.md without it.

### When a free-form list reads "tick exactly one", does ticking a box untick its siblings?

Yes, for every task list on the free-form screen — ticking one box unticks every
other box in the same list, even where no "exactly one" wording appears;
free-form checklists meant to hold several ticks lose that from the phone.

### Which boxes count as "the same list"?

The direct sibling items of one list — a nested list is its own group, so
pick-one never reaches across levels or into other lists.
