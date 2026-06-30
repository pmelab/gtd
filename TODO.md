# Plan

## Problem

`seedNewFeature` (`src/Events.ts:383`) captures the just-committed
`gtd: new task` changeset via `git.diffRef("HEAD~1")` (which runs
`git diff HEAD~1 HEAD`, `src/Git.ts:97`). When the `gtd: new task` commit is the
**first commit in the repo**, `HEAD~1` does not resolve, the `catchAll` at
`src/Events.ts:392` swallows the error and returns `""`, and TODO.md is seeded
with an empty diff block. The captured code was committed then reverted out of
the working tree (`revertNoCommit("HEAD")`, `src/Events.ts:393`), so it survives
only as a dangling git object — invisible to the planning agent.

The existing tests never caught this because `initRepo`
(`src/Events.test.ts:34`) always lays down a `chore: init` baseline, so `HEAD~1`
always resolves.

## Fix

In `src/Events.ts`, `seedNewFeature` case (~line 390), compute the diff base:
use `HEAD~1` when a parent commit exists, otherwise diff against the empty-tree
SHA `EMPTY_TREE` (`4b825dc642cb6eb9a060e54bf8d69288fbee4904`, already defined at
`src/Events.ts:50`). `git.diffRef(EMPTY_TREE)` runs
`git diff <empty-tree> HEAD`, which yields the full contents of the first commit
as additions.

Detect the presence of a parent commit with the existing
`git.resolveRef("HEAD~1")` (`src/Git.ts:101`), which returns an `Option` and
already handles non-resolving refs. Concretely, replace:

```ts
const captured =
  yield * git.diffRef("HEAD~1").pipe(Effect.catchAll(() => Effect.succeed("")))
```

with logic that resolves `HEAD~1`; if `Option.isSome`, diff against `"HEAD~1"`,
else diff against `EMPTY_TREE`. Keep the `catchAll(() => "")` guard as a final
safety net. This mirrors the existing `... ?? EMPTY_TREE` fallback pattern at
`src/Events.ts:318`.

Note: at this point `gtd: new task` is always HEAD — the case either commits it
(`src/Events.ts:388`) or it was already HEAD (clean-regenerate path) — so HEAD
is the correct "after" side for both branches.

## Test

Add a Cucumber scenario / unit test exercising the no-parent case. The cleanest
spot is `src/Events.test.ts` alongside the existing `seedNewFeature` tests
(lines 533, 542). Add a third `it` that initialises a repo with **no baseline
commit** (do not call `initRepo`; init the repo and configure user, but make NO
`chore: init` commit), write a feature file, run
`runPerform({ kind: "seedNewFeature" })`, then assert:

- `git log -1 --format=%s` is `gtd: new task` (first and only commit)
- `TODO.md` exists and its content **contains the captured change** (e.g. the
  feature file name / `export const raw = 1`), not just the `Captured input`
  header — this is the assertion that fails before the fix
- the feature file no longer exists in the working tree (reverted to baseline)

Because `initRepo` always commits a baseline, this test needs a small local
setup that skips the `chore: init` commit (inline it per the
no-one-off-setup-step guidance, or add a parameter to `initRepo`). Verify the
existing two `seedNewFeature` tests still pass (parent-commit path unchanged).

## README

The README does not document `seedNewFeature` internals; no README change is
needed for this bug fix unless a behavioural note about empty-repo capture is
deemed useful — it is not, so skip.

no open questions — run gtd to plan
