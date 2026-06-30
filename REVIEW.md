# Review: 3597cd3

<!-- base: 3597cd3d6277a5d3dc9b21404efe6469060a98ce -->

## Delete TODO.md at the planning→building edge

New `removeTodo` flag on the `commitPending` EdgeAction. Rule 3 gates the first
Building dispatch so that when HEAD is `gtd: planning` and TODO.md still exists,
the planning commit deletes TODO.md (fires once). Events honors the flag.
TODO.md is now removed in the self-contained `gtd: planning` commit rather than
at package close.

- [ ] ./src/Machine.ts#160
- [ ] ./src/Machine.ts#407
- [ ] ./src/Events.ts#369

## closePackage no longer removes TODO.md

The last-package TODO.md cleanup is dropped from `closePackage` (removal now
happens at the build edge). Verify the fall-through reasoning the old comment
described (rule 6 → rule 7) is still satisfied now that TODO.md is gone before
Close package ever runs.

- [ ] ./src/Events.ts#379

## Tests for removeTodo and closePackage

New `perform` test asserts removeTodo deletes TODO.md and lands a `D TODO.md` in
the `gtd: planning` commit. closePackage tests drop the TODO.md
seeding/assertions. Machine tests split rule 3 into todoExists / !todoExists
cases and assert no edgeAction on `gtd: package done`.

- [ ] ./src/Events.test.ts#515
- [ ] ./src/Machine.test.ts#278

## Remove ## Resolved from REVIEW.md format

Pure prompt edit: drops the `## Resolved` block and the "moves into Resolved"
bullet, replacing it with check-off / edit-in-place guidance.

- [ ] ./src/prompts/clean.md#32
- [ ] ./src/prompts/clean.md#43

## Docs and prompts

Decompose prompt now states TODO.md is deleted at the first Building turn (not
left in place). Building prompt adds a note that TODO.md absence during the
build loop is intentional. STATES.md and README updated: legal coexistence,
Building actions, and the Build narrative reflect the once-only TODO.md
deletion; closePackage docs drop the last-package TODO.md removal.

- [ ] ./src/prompts/decompose.md#48
- [ ] ./src/prompts/building.md#26
- [ ] ./STATES.md#184
- [ ] ./README.md#233
