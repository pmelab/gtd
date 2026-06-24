# Introduce `EdgeAction` + no-agent `GitService` ops

Lay the foundation for the machine-directed-action model **without touching the
machine or main.ts yet**. Add the typed `EdgeAction` union and the three
"fire-and-re-gather" git operations the no-agent leaves will need, plus unit
tests. Nothing wires these in this package — `Machine.ts` / `State.ts` /
`main.ts` are unchanged. This keeps `npm run test` green on its own: the new
symbols are pure additions covered by new tests.

## Files (all in this one task — they are interdependent on `Git.ts`)

- `src/Machine.ts` — add the exported `EdgeAction` type only (no behavior change).
- `src/Git.ts` — add three new ops to `GitOperations` + their `GitService.Live`
  implementations; extract `closeReview` from the tail of `recordAndRevertReview`.
- `src/Git.test.ts` — cover the three new ops.

> NOTE: this task edits `src/Machine.ts` (type addition) AND `src/Git.ts`. No
> other task in package 01 exists, so there is no file-disjointness conflict.

## What to add

### `EdgeAction` type (`src/Machine.ts`)

Add this exported union near the top (after `GtdEvent` / `LeafState` is fine).
Do NOT yet reference it from `ResolveResult` or any state — type-only addition:

```ts
export type EdgeAction =
  // no-agent git ops (result = re-gathered events)
  | { kind: "removeGtdDir" }
  | { kind: "closeReview"; base: string }
  | { kind: "commitPending" }
  // side-effect actions whose result feeds back as an event
  | { kind: "runTestGate" }
  | { kind: "reviewPreRender"; base: string }
```

### `GitService.removeGtdDir()` (`src/Git.ts`)

- Signature: `readonly removeGtdDir: () => Effect.Effect<void, Error>`.
- Implementation: remove the `.gtd/` directory recursively. Use a git-aware
  removal consistent with the existing `exec("git", ...)` style — e.g.
  `git rm -r --cached .gtd` is NOT enough (the dir may be untracked); prefer
  removing the working-tree directory. Use the existing `CommandExecutor`
  `exec` helper with `rm -rf .gtd` OR (preferred, no shell) resolve via
  `FileSystem` is out of scope here — keep it inside `GitService` using `exec`.
  Implement as `exec("rm", "-rf", ".gtd")` returning `void` (map the string
  output away with `Effect.asVoid`). Idempotent: removing a non-existent dir is
  a no-op (`rm -rf` already is).

### `GitService.closeReview(base)` (`src/Git.ts`)

- Signature:
  `readonly closeReview: (base: string) => Effect.Effect<void, Error>`.
- Extract VERBATIM from the tail of `recordAndRevertReview`
  (`src/Git.ts:230-252` — the "4. Remove REVIEW.md if still tracked, then close
  commit" block). It must: discard the working-tree `REVIEW.md`
  (`git checkout -- REVIEW.md`, tolerate failure if untracked), `git rm
  REVIEW.md` (via `Command.exitCode`, tolerate non-zero), then commit
  `chore(gtd): close approved review for ${base.slice(0, 7)}` — using
  `--allow-empty` when REVIEW.md was not tracked, exactly as the existing tail
  does.
- **Refactor `recordAndRevertReview` to call `closeReview(base)`** for its step
  4 so the two sites share one implementation (the plan's "Reuse from both
  sites"). Its returned `{ diff, recordSha }` contract is unchanged.

### `GitService.commitPending()` (`src/Git.ts`)

- Signature: `readonly commitPending: () => Effect.Effect<void, Error>`.
- Implementation: `git add -A`, then
  `git restore --staged TODO.md REVIEW.md` (tolerate the restore failing when
  those paths are not staged — wrap in `Effect.catchAll(() => Effect.void)`),
  then commit `chore(gtd): commit pending changes`. **Skip the commit when
  nothing is staged**: check `git diff --cached --name-only` (or
  `git diff --cached --quiet` via `Command.exitCode`) and no-op if empty, so a
  tree with only TODO.md/REVIEW.md dirty produces no empty commit.

## Acceptance criteria

- [ ] `src/Machine.ts` exports `EdgeAction` with all five `kind`s; no other
      change to `Machine.ts` (still no IO; `resolve`/`ResolveResult` untouched).
- [ ] `GitOperations` gains `removeGtdDir`, `closeReview`, `commitPending`;
      `GitService.Live` implements all three.
- [ ] `recordAndRevertReview` now delegates its close step to `closeReview` and
      still returns `{ diff, recordSha }` unchanged (existing `Git.test.ts`
      cases for it stay green).
- [ ] `commitPending` restores `TODO.md` + `REVIEW.md` from the index and skips
      the commit when nothing else is staged.
- [ ] `removeGtdDir` is idempotent (no error when `.gtd/` is absent).
- [ ] `npm run test` is green.
- [ ] `npm run typecheck` passes (the new `EdgeAction` type compiles; unused is
      acceptable in this package).

## Tests this task MUST add/update (to stay green)

- `src/Git.test.ts` — new cases (use the existing in-repo git fixture pattern in
  that file):
  - `removeGtdDir` deletes a populated `.gtd/`; second call on an absent dir
    succeeds.
  - `closeReview("<sha>")` on a repo with a committed REVIEW.md + ticked working
    copy: working edits discarded, REVIEW.md removed, HEAD subject ===
    `chore(gtd): close approved review for <7-char>`.
  - `closeReview` with REVIEW.md untracked still creates the (allow-empty) close
    commit.
  - `commitPending` with a dirty `src/x.ts` + dirty `TODO.md`: commits
    `chore(gtd): commit pending changes`, TODO.md stays dirty (uncommitted),
    `x.ts` committed.
  - `commitPending` with ONLY `TODO.md` dirty: no new commit created (HEAD
    unchanged).
  - Keep / adapt existing `recordAndRevertReview` cases — they must remain green
    after the `closeReview` extraction.

## Constraints / edge cases

- `Git.ts` stays the only place doing git writes; `Events.ts` stays read-only.
- Follow the `recordAndRevertReview` precedent for `Command.exitCode` +
  `Effect.provide(Layer.succeed(CommandExecutor...))` when a non-zero exit must
  not throw.
- Do NOT change `Machine.ts` behavior, `State.ts`, `main.ts`, or any prompt in
  this package.
