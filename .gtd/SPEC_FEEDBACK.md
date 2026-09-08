# Spec feedback — 02 One worktree, one step, one exit

Last round's `resolveFleet` prop is gone and every gate is green: `typecheck`,
`deadcode` (fallow clean, no test-only entry), `npm test` (10/10),
`format:check`. Server-side the package is done — modules deleted,
`worktreePath` off every procedure input, `findOwnVersion` memoized, beat read
before host/cert, handoff deferred with a cleared 2s fallback, `GtdUsageError` →
exit 2, config struct stripped, docs and the lifecycle feature rewritten.

Four problems remain, all in `src/web/` — the same "unused door" Requirement B
names, just on the client side of the router.

## 1. `worktreePath` still threads from the client into `Review`

`src/web/App.tsx:34` passes `worktreePath={step.path}` into `Review`;
`src/web/screens/Review.tsx:47,224-247,353,389,396,462` carries it down through
`HunkDeck`. It reaches no procedure — `Router.ts#diff` takes only `path`/`line`
— so its ONLY remaining job is a presence check at `Review.tsx:243`
(`worktreePath !== undefined` → render `HunkWithDiff`, else the pure-data
`Hunk`). A filesystem path from the server round-tripped through the client to
serve as a boolean "am I the real container" flag is exactly the path residue
Requirement B says leaves the design. Replace the flag with something that says
what it means (a `live?: boolean`, or splitting the story-only variant), and
drop the prop from `App.tsx`, `ReviewProps`, `HunkDeckProps` and their JSDoc at
`Review.tsx:224` and `:397`.

## 2. `PlanProps.onDone` / `ReviewProps.onDone` are unwired doors

`src/web/screens/Plan.tsx:420` and `src/web/screens/Review.tsx:400` declare
`onDone?: () => void`, fired at `Plan.tsx:465` and `Review.tsx:449`. `App.tsx` —
the only production consumer of either container — passes neither. There is
nowhere to navigate: `done` exits the process, which `App.tsx:21-22` states
itself. Either delete both props and their call sites, or, if a story genuinely
needs the hook, say so in the JSDoc instead of claiming `App.tsx` wires it.

## 3. Three JSDoc blocks describe the spawn and the fleet this package deleted

Each asserts behaviour that no longer exists, in files a reader trusts:

- `src/web/screens/Plan.tsx:198-205` — `onDoneNote` "hands the turn back — the
  real `Plan` container wires this to `trpc.done`, whose own resolution (spawn
  registered, never waiting for the child to exit) is what lets the caller
  navigate back to the fleet list immediately". No spawn, no child, no fleet
  list: `done` writes, returns `{ ok: true }`, and calls `ctx.handOff()`.
- `src/web/screens/Plan.tsx:415-419` — "Called once `trpc.done` resolves (spawn
  registered, not the child's own exit) — `App.tsx` wires this to navigate back
  to the fleet list, T2's own 'the phone returns to the fleet list immediately,
  without waiting for the child'." Same three dead facts, plus the wiring claim
  problem 2 covers.
- `src/web/screens/Plan.tsx:429` and `src/web/screens/Review.tsx:411` —
  "`App.tsx` renders this when a tapped fleet row's `mode` is/isn't `review`".
  There are no fleet rows; `App.tsx:32` switches on `trpc.step`'s own `mode`.

`src/web/screens/Review.tsx:399` and `:61` defer to the Plan comments ("mirrors
`Plan.tsx#PlanProps.onDone`'s identical doc comment"), so fixing Plan fixes
those by reference — but check them once Plan is right.
`src/web/screens/Plan.stories.tsx:463` repeats "T2's own 'the phone returns to
the fleet list immediately'" and needs the same edit.

## 4. `Plan.stories.tsx`'s `REAL_PLAN_ARGS` passes a prop `Plan` does not have

`src/web/screens/Plan.stories.tsx:17` is
`{ worktreePath: "/repo", filePath: ".gtd/PLAN.md", mode: "qa" }`, used at
`:388`, `:433`, `:497`. `PlanProps` is `filePath`/`mode`/`onDone` — no
`worktreePath`. It is silently ignored, and it is the last thing in the repo
suggesting a Plan screen is keyed on a client-supplied worktree path. Drop the
key.

## 5. Minor: the `ui.loop` scenario never pins exit 2

`tests/integration/features/ui-lifecycle.feature`'s last scenario asserts
`Then it fails` and `stderr contains "loop"`. The `ConfigSchema.ts` task bullet
says the decode failure is **exit 2**, and no test asserts that exit code for a
config decode failure at all (`Config.test.ts:199` and
`ConfigSchema.test.ts:156,160` assert the schema rejection, not the process
code). Add `And the exit code is 2`, matching the `ui.feature` refusal
scenarios.
