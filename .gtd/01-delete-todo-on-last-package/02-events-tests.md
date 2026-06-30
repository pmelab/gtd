# Task: assert TODO.md handling in `closePackage` tests

File: `src/Events.test.ts` (only this file)

## Context

`closePackage` now deletes TODO.md when it closes the **last** package, and
keeps TODO.md while packages remain. Extend the two existing `closePackage`
tests (~L515-543) to lock in both behaviors. These assertions depend on the
`src/Events.ts` change in the sibling task; the gtd loop runs the suite after
the whole package lands, so they will be green together.

## Changes

### 1. "closePackage (empty FEEDBACK)" test (~L515-528, single package `01-foo`)

This is the **last-package** case — it must prove the loop is broken.

- Before the `gtd: building` commit, write a `TODO.md` and let it be committed
  by the existing `git("add", "-A")` / `git("commit", ...)` (so TODO.md is
  tracked at the build commit).
- After `runPerform({ kind: "closePackage" })`, add assertions:
  - `expect(existsSync(join(repoDir, "TODO.md"))).toBe(false)`
  - `expect(git("ls-files", "TODO.md").trim()).toBe("")`
  - `expect(git("status", "--porcelain").trim()).toBe("")` (deletion committed,
    tree clean)

### 2. "closePackage (force-approve, no FEEDBACK)" test (~L530-543, two packages)

This is the **packages-remaining** case — TODO.md must survive.

- Before the `gtd: building` commit, write a `TODO.md` (committed with the rest).
- After `runPerform({ kind: "closePackage" })`, add assertions:
  - `expect(existsSync(join(repoDir, "TODO.md"))).toBe(true)`
  - (keep the existing `02-bar` survives + `01-foo` gone assertions)

## Acceptance criteria

- [ ] Single-package test writes & commits a TODO.md and asserts it is gone,
      untracked (`git ls-files TODO.md` empty), and tree clean after
      `closePackage`.
- [ ] Two-package test writes & commits a TODO.md and asserts it still exists
      after `closePackage`.
- [ ] Existing assertions in both tests are preserved.
- [ ] Full test suite passes (`bun test` or project equivalent).
