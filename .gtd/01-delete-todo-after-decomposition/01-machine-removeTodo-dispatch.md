# Task: Add `removeTodo` to the machine and gate the first Building dispatch

Wire the `removeTodo` flag into the pure machine so that the Planning→Building
boundary deletes `TODO.md` exactly once.

## Files

- `src/Machine.ts` (edit)
- `src/Machine.test.ts` (edit — owns the machine-level tests)

Do **not** touch `src/Events.ts` or `src/Events.test.ts` (owned by task 02).

## What to build

### `src/Machine.ts`

1. Add an optional `removeTodo?: boolean` field to the `commitPending` variant
   of the `EdgeAction` union (the line near `commitPending`; `kind: "commitPending"; prefix: string; removeFeedback?: boolean`).
   Mirror the existing `removeFeedback?` flag exactly.

2. Update the `EdgeAction` doc comment for `commitPending` to mention that
   `removeTodo` deletes `TODO.md` first so its removal lands in the
   `gtd: planning` commit (mirror the existing `removeFeedback` sentence).

3. In rule 3 (`.gtd present → build lifecycle`), in the
   `if (p.workingTreeClean)` block where `head === "gtd: planning" || head === "gtd: package done"`
   currently returns `{ state: "building", autoAdvance: true, context: ... }`
   with no edge action — change it so that:
   - when `head === "gtd: planning" && p.todoExists`, the returned Building
     result carries `edgeAction: { kind: "commitPending", prefix: "gtd: planning", removeTodo: true }`
     (records the `TODO.md` deletion under a `gtd: planning` commit — HEAD prefix
     unchanged, so the next resolve with `todoExists: false` falls into the
     existing no-edge-action Building dispatch).
   - otherwise (`head === "gtd: package done"`, or `head === "gtd: planning"`
     with `!p.todoExists`) keep the current behavior: Building with **no** edge
     action.

   Keep `state: "building"` and `autoAdvance: true` in all cases. Add a short
   code comment explaining the once-only deletion at the planning→building edge.

### `src/Machine.test.ts`

Around the existing test `"clean + HEAD gtd: planning → building, no edgeAction"`
(near line 278):

- Update / keep a variant asserting `head === "gtd: planning"` with
  `todoExists: false` → `state: "building"`, `autoAdvance: true`,
  `edgeAction` undefined (current behavior preserved). The existing `r()` helper
  defaults `todoExists` to false — verify the default so this stays green.
- Add a variant: `head === "gtd: planning"` with `todoExists: true` →
  `state: "building"`, `autoAdvance: true`, and
  `edgeAction` equals `{ kind: "commitPending", prefix: "gtd: planning", removeTodo: true }`.
- Verify the existing `"clean + HEAD gtd: package done → building"` test still
  passes (no edge action even if `todoExists: true` — add a `todoExists: true`
  assertion there if cheap, otherwise leave it).

## Acceptance criteria

- [ ] `EdgeAction` `commitPending` variant has optional `removeTodo?: boolean`
- [ ] `commitPending` doc comment documents `removeTodo`
- [ ] Rule 3 Building dispatch returns `commitPending { prefix: "gtd: planning", removeTodo: true }` when `head === "gtd: planning" && p.todoExists`
- [ ] Rule 3 Building dispatch returns no edge action when `head === "gtd: package done"` or when `head === "gtd: planning" && !p.todoExists`
- [ ] `src/Machine.test.ts` has a `todoExists: true` variant asserting the `removeTodo: true` edge action and a `todoExists: false` variant asserting no edge action
- [ ] `npx vitest run src/Machine.test.ts` is green
- [ ] `npx tsc --noEmit` is clean
