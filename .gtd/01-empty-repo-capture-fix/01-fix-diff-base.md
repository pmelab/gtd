# Fix `seedNewFeature` diff base for first-commit repos

## Description

In `seedNewFeature` (`src/Events.ts`, ~line 390), the captured changeset is
computed with `git.diffRef("HEAD~1")` guarded by `catchAll(() => "")`. When the
`gtd: new task` commit is the **first commit in the repo**, `HEAD~1` does not
resolve, the error is swallowed, and TODO.md is seeded with an empty diff block.

Fix: resolve `HEAD~1` to a base ref first, falling back to the empty-tree SHA
`EMPTY_TREE` (already defined at `src/Events.ts:50`) when it fails, then diff
against that base. `git.diffRef(EMPTY_TREE)` runs `git diff <empty-tree> HEAD`,
yielding the full first-commit contents as additions.

Use the existing `git.resolveRef(...)` primitive (`src/Git.ts:101`), which runs
`git rev-parse --verify` and **fails** on a non-resolving ref (mirroring the
`resolveRef("HEAD")` + `catchAll` usage at `src/Events.ts:204`). Keep the
`catchAll(() => "")` guard on `diffRef` as a final safety net.

Concretely, replace:

```ts
const captured =
  yield * git.diffRef("HEAD~1").pipe(Effect.catchAll(() => Effect.succeed("")))
```

with:

```ts
const base =
  yield *
  git
    .resolveRef("HEAD~1")
    .pipe(Effect.catchAll(() => Effect.succeed(EMPTY_TREE)))
const captured =
  yield * git.diffRef(base).pipe(Effect.catchAll(() => Effect.succeed("")))
```

At this point `gtd: new task` is always HEAD (the case either commits it at
`src/Events.ts:388` or it was already HEAD in the clean-regenerate path), so
HEAD is the correct "after" side for both branches. This mirrors the existing
`... ?? EMPTY_TREE` fallback at `src/Events.ts:318`.

## Acceptance criteria

- [ ] `seedNewFeature` resolves `HEAD~1` to a base, falling back to `EMPTY_TREE`
      on failure, then diffs against that base
- [ ] `diffRef` still has a `catchAll(() => Effect.succeed(""))` final guard
- [ ] No new `EMPTY_TREE` constant introduced — reuse the one at
      `src/Events.ts:50`
- [ ] `npx tsc --noEmit` (or the project typecheck) passes
- [ ] Existing test suite stays green

## Relevant files

- `src/Events.ts` (edit `seedNewFeature` case, ~lines 390-392)
- `src/Events.ts:50` — `EMPTY_TREE` constant (reuse)
- `src/Git.ts:101` — `resolveRef` (fails on non-resolving ref)
- `src/Git.ts:97` — `diffRef` (`git diff <ref> HEAD`)

## Constraints

- Touch **only** `src/Events.ts`. Do NOT edit `src/Events.test.ts` (that is the
  parallel task in this package).
- Do not add new Git primitives; use `resolveRef` and `diffRef` as-is.
- Do not run `git add` / `git commit`.
