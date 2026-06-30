# Task: Make `mixedResetHead()` fail clearly on a root transport commit

Rewrite `mixedResetHead()` in `src/Git.ts` so it detects the root-commit case
and surfaces git's own failures instead of swallowing them.

## Problem

`mixedResetHead()` (`src/Git.ts:151`) currently runs `git reset HEAD~1` through
the shared `exec` helper, which uses `Command.string`. `Command.string`
resolves the Effect **even on a non-zero git exit** — it only surfaces spawn
failures. So when HEAD is the repo's root commit, `git reset HEAD~1` exits
non-zero, the failure is swallowed, `mixedResetHead()` reports success, but the
tree is unchanged. The driver re-gathers, still sees `gtd: transport` at HEAD,
re-resolves `transportReset`, and loops until `MAX_EDGE_HOPS` (100) — an opaque
crash.

## What to do

Rewrite `mixedResetHead()` to:

1. Probe for a parent first: `git rev-parse --verify --quiet HEAD~1` via
   `Command.exitCode`. Exit `0` ⇒ a parent exists; non-zero ⇒ HEAD is the root
   commit.
2. If **no parent**, `Effect.fail` with a clear message:
   `"cannot reset transport commit: it is the repository root commit (no parent to reset to)"`.
3. If a parent **exists**, run `git reset HEAD~1` via `Command.exitCode` (NOT
   `Command.string`) and `Effect.fail` when the exit code is non-zero (e.g.
   `` `git reset HEAD~1 failed (exit ${resetCode})` ``), so any future reset
   failure also surfaces.

Reuse the established `Command.exitCode` +
`Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor))` +
`Effect.mapError((e) => new Error(String(e)))` pattern already used by
`isAncestor` (`src/Git.ts:138`) and `removePackageDir` (`src/Git.ts:203`). See
the worked shape in `TODO.md` § "1. `mixedResetHead()` must detect git
failures and the root-commit case".

## Out of scope

- Do **not** touch `hasCommits()` — `TODO.md` § "2. Leave `hasCommits()` as-is".
- Do not change any other `GitOperations` method or its signature
  (`mixedResetHead` stays `() => Effect.Effect<void, Error>`).

## Files

- Modify: `src/Git.ts`

## Constraints

- Keep the `Effect.Effect<void, Error>` signature.
- Match the existing `Command.exitCode` call sites exactly (executor layer +
  `mapError` to `Error`).
- The non-root path must stay behaviourally unchanged (parent exists →
  `git reset HEAD~1` succeeds → work re-derives), so the existing first
  scenario in `tests/integration/features/transport.feature` stays green.
- Run `npm run typecheck` and `npm run lint` before considering this done.
- Reflect the fix in the README if it documents transport / Git primitives.

## Acceptance criteria

- [ ] `mixedResetHead()` probes `git rev-parse --verify --quiet HEAD~1` via
      `Command.exitCode` before resetting.
- [ ] On a root commit (no parent) it returns `Effect.fail` with a message
      containing `"root commit"`.
- [ ] On a non-root commit it runs `git reset HEAD~1` via `Command.exitCode`
      and fails when the exit code is non-zero.
- [ ] The shared `Command.string`-based `exec` is no longer used inside
      `mixedResetHead()`.
- [ ] `hasCommits()` and all other `GitOperations` methods are unchanged.
- [ ] `npm run typecheck` and `npm run lint` pass.
