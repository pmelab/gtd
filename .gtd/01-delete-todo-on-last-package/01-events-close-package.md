# Task: delete TODO.md in `closePackage` when closing the last package

File: `src/Events.ts` (only this file)

## Context

After `gtd: package done` closes the last package, TODO.md is left on disk. In
`src/Machine.ts` rule 6 (`todoExists` → Grilling/Grilled) is checked before
rule 7 (`package done` HEAD + clean → Clean/Idle), so the machine loops on
Grilled forever. Fix: have `closePackage` also remove TODO.md when the package
being closed is the last one, before the `gtd: package done` commit, so the
deletion is staged by `commitAllWithPrefix`'s `git add -A`.

## Changes

In the `closePackage` case (currently ~L379-388), after the `removePackageDir`
block and before `git.commitAllWithPrefix(PACKAGE_DONE_SUBJECT)`, add a
last-package TODO.md removal guarded by `packages.length <= 1`:

```ts
if (packages.length <= 1) {
  yield* fs.remove(TODO_FILE).pipe(Effect.catchAll(() => Effect.void))
}
```

- `TODO_FILE` const is already in scope (`src/Events.ts:23`).
- Use `packages.length <= 1` (not `=== 1`) so the force-approve / no-package
  edge also clears a dangling TODO.md.
- The `fs.remove(...).pipe(Effect.catchAll(() => Effect.void))` pattern mirrors
  the existing FEEDBACK.md removal — tolerates an absent TODO.md.

Also update the doc comment above the case (currently ~L376-378). Append a
clause noting that when it was the last package, TODO.md is also removed — e.g.
"…rm the first (finished) package dir (+ the now-empty `.gtd/`), and — when it
was the last package — rm TODO.md, then commit `gtd: package done`."

## Acceptance criteria

- [ ] `closePackage` removes `TODO.md` (via `fs.remove` + `Effect.catchAll`)
      when `packages.length <= 1`, placed after `removePackageDir` and before
      `commitAllWithPrefix(PACKAGE_DONE_SUBJECT)`.
- [ ] The condition is `packages.length <= 1`.
- [ ] When packages remain (`length > 1`), TODO.md is NOT removed.
- [ ] The doc comment above the `closePackage` case mentions the last-package
      TODO.md removal.
- [ ] No other behavior in the case changes (FEEDBACK removal, removePackageDir,
      commit prefix all unchanged).
- [ ] `bun run typecheck` (or project equivalent) passes.
