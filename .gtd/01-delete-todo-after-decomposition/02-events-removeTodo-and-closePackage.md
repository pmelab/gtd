# Task: Honor `removeTodo` in the edge and stop deleting TODO.md in closePackage

Implement the edge side of the `removeTodo` flag and remove the now-dead
last-package `TODO.md` deletion from `closePackage`.

## Files

- `src/Events.ts` (edit)
- `src/Events.test.ts` (edit — owns the edge/perform tests)

Do **not** touch `src/Machine.ts` or `src/Machine.test.ts` (owned by task 01).
The `removeTodo` field on the `commitPending` `EdgeAction` type is added by task
01; this task only reads it. Since tasks run against the same working tree
simultaneously, reference `action.removeTodo` directly — if the type field is
not yet present at compile time, the green gate is the package-level
`tsc --noEmit` after both tasks land.

## What to build

### `src/Events.ts`

1. In `perform`, `case "commitPending"`: before `commitAllWithPrefix`, in
   addition to the existing `removeFeedback` handling, add:
   if `action.removeTodo === true`, run
   `yield* fs.remove(TODO_FILE).pipe(Effect.catchAll(() => Effect.void))`
   so the deletion lands in the `gtd: planning` commit (mirror `removeFeedback`).

2. In `case "closePackage"`: delete the block
   ```
   if (packages.length <= 1) {
     yield* fs.remove(TODO_FILE).pipe(Effect.catchAll(() => Effect.void))
   }
   ```
   (`TODO.md` is already gone by the time any package closes — dead code).

3. Update the `closePackage` doc comment: drop the
   "When it was the last package, also removes TODO.md." line.

### `src/Events.test.ts`

1. Add a `commitPending` test with `removeTodo: true` (mirror the
   `removeFeedback` tests near line 493): set up a committed `TODO.md`
   (e.g. `commitFile("gtd: grilled", "TODO.md", "# Plan\n")` or commit it via the
   helper used elsewhere), add a pending `.gtd` change, run
   `runPerform({ kind: "commitPending", prefix: "gtd: planning", removeTodo: true })`,
   then assert:
   - `existsSync(.../TODO.md)` is `false`
   - HEAD subject is `gtd: planning`
   - `git status --porcelain` is empty
   - `git show --name-status --format= HEAD` contains `D\tTODO.md`
     (deletion recorded in the commit — provenance preserved)

2. Update `"closePackage (empty FEEDBACK): ..."` (lines ~515-532): with Change 1,
   `TODO.md` is already gone before close-package. Set up the tree with **no**
   committed `TODO.md` and drop the
   `expect(existsSync(.../TODO.md)).toBe(false)` /
   `expect(git("ls-files", "TODO.md")...)` assertions tied to close-package
   removal (the test should no longer assert close-package removes TODO.md).

3. Update `"closePackage (force-approve, no FEEDBACK): ..."` (lines ~534-549):
   remove the `writeFileSync(... "TODO.md" ...)` setup and the
   `expect(existsSync(.../TODO.md)).toBe(true)` assertion — `TODO.md` is no
   longer present during the build loop, so close-package neither keeps nor
   removes it.

## Acceptance criteria

- [ ] `commitPending` case removes `TODO.md` (catchAll-guarded) before commit when `action.removeTodo === true`
- [ ] `closePackage` case no longer removes `TODO.md` and its doc comment drops the last-package TODO.md line
- [ ] `src/Events.test.ts` has a `commitPending removeTodo: true` test asserting `D\tTODO.md` is recorded in the `gtd: planning` commit
- [ ] The two `closePackage` tests no longer assert TODO.md removal/retention at close time
- [ ] `npx vitest run src/Events.test.ts` is green
