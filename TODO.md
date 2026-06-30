# Plan: delete TODO.md when Close Package removes the last package

## Problem

After `gtd: package done` closes the last package, TODO.md is still present on
disk. In the decision tree (`src/Machine.ts`), rule 6 (`p.todoExists` →
Grilling/Grilled) is checked **before** rule 7 (boundary/`package done` HEAD +
clean → Clean/Idle). So once the last package is gone and the tree is clean, the
machine matches rule 6 → Grilled, commits an empty `gtd: grilled`, re-resolves
to Grilled again — infinite loop. Manual workaround: `rm TODO.md` + boundary
commit.

## Fix

Close Package already removes the finished package dir and, via
`removePackageDir` (`src/Git.ts`), the now-empty `.gtd/`. Extend the
`closePackage` edge action to **also delete TODO.md when the package being
closed is the last one** — i.e. when `getPackages` returned at most one package.
That makes the next run see no TODO.md and no `.gtd/`, so it falls through rule
6 and matches rule 7 → Clean (or Idle).

Only delete TODO.md on the **last** package. With packages remaining, TODO.md
must stay (legal `.gtd`+TODO.md coexistence during build).

## Changes

### `src/Events.ts` — `closePackage` case (around lines 379-388)

Current:

```ts
case "closePackage": {
  yield* fs.remove(FEEDBACK_FILE).pipe(Effect.catchAll(() => Effect.void))
  const packages = yield* getPackages(fs)
  const first = packages[0]
  if (first !== undefined) {
    yield* git.removePackageDir(`${GTD_DIR}/${first.name}`)
  }
  yield* git.commitAllWithPrefix(PACKAGE_DONE_SUBJECT)
  return
}
```

Add a TODO.md removal when this is the last package, before the commit so
`commitAllWithPrefix`'s `git add -A` stages the deletion:

```ts
case "closePackage": {
  yield* fs.remove(FEEDBACK_FILE).pipe(Effect.catchAll(() => Effect.void))
  const packages = yield* getPackages(fs)
  const first = packages[0]
  if (first !== undefined) {
    yield* git.removePackageDir(`${GTD_DIR}/${first.name}`)
  }
  // Closing the last package finishes the feature: drop the plan so the next
  // run falls through rule 6 (TODO.md) to rule 7 (Clean/Idle) instead of
  // looping on Grilled.
  if (packages.length <= 1) {
    yield* fs.remove(TODO_FILE).pipe(Effect.catchAll(() => Effect.void))
  }
  yield* git.commitAllWithPrefix(PACKAGE_DONE_SUBJECT)
  return
}
```

Notes:

- `TODO_FILE` const already in scope (`src/Events.ts:23`).
- `fs.remove` + `Effect.catchAll` mirrors the existing FEEDBACK.md tolerance
  (TODO.md may be absent in the force-approve path). `git add -A` in
  `commitAllWithPrefix` (`src/Git.ts:228`) stages the deletion whether TODO.md
  was tracked or not.
- `packages.length <= 1` (not `=== 1`) so the force-approve / no-package edge
  also clears a dangling TODO.md if one is present.

### `src/Events.ts` — doc comment (lines 151-152)

The `closePackage` description reads "rm the (maybe-empty / maybe-absent)
FEEDBACK.md, rm the first package dir (+ empty `.gtd/`)…". Append "and, when it
was the last package, rm TODO.md" so the comment stays accurate.

## Tests

### `src/Events.test.ts` — perform/closePackage block (lines 515-543)

1. Extend **"closePackage (empty FEEDBACK)"** (line 515, single package
   `01-foo`): write and commit a TODO.md before the build commit, then assert
   after `closePackage` that `existsSync(TODO.md) === false`,
   `git ls-files TODO.md` is empty, and `git status --porcelain` is clean
   (deletion committed). This last-package case proves the loop is broken.

2. Extend **"closePackage (force-approve, no FEEDBACK)"** (line 530, two
   packages `01-foo`+`02-bar`): write a TODO.md, then assert after closing
   `01-foo` that `existsSync(TODO.md) === true` and `02-bar` survives — TODO.md
   is kept while packages remain.

### `src/Machine.test.ts` — regression note (optional)

The fix is purely in the edge action; no machine logic changes. Rule-6
(line 397) and rule-7 (line 424) tests already cover the resolve precedence. The
rule-7 test (`gtd: package done` HEAD + clean + reviewable → clean) already
asserts `clean` with `todoExists` defaulting to false, which documents that
Close Package must clear TODO.md to reach it. No new test required, but add a
clarifying comment on that test linking it to this fix.

## Docs

- `STATES.md` — under the Close package state description, note that closing the
  **last** package also removes TODO.md, so the workflow terminates at
  Clean/Idle rather than re-entering Grilling.
- `README.md` — skip. Per MEMORY, STATES.md is the authoritative redesign target
  and README sync is intentionally deferred.

## Open questions resolved

- **Where to put the deletion?** In `closePackage` (Events.ts), not in
  `removePackageDir` (Git.ts). TODO.md is a steering-file concern and belongs
  next to the FEEDBACK.md removal already in that case; Git.ts stays purely
  about git/package-dir mechanics.
- **Last-package signal?** `packages.length <= 1` from the `getPackages` call
  already made in the case — no extra `.gtd/` re-check needed.
- **README vs STATES.md?** Per MEMORY, update STATES.md only; README sync
  deferred.

no open questions — run gtd to plan
