# Fix: Transport root-commit crash (issue #9)

## Goal

Fix the `MAX_EDGE_HOPS` crash that happens when a `gtd: transport` commit is the
repo's **root commit** (has no parent).

## Problem

The machine treats `gtd: transport` as precedence-0 (`Machine.ts:345`): it
mixed-resets that HEAD to drop the commit while keeping the work in the tree,
then re-derives. The reset is `transportReset` → `git.mixedResetHead()`
(`Events.ts:375`).

`mixedResetHead()` (`src/Git.ts:151`) runs `git reset HEAD~1` via the shared
`exec` helper, which uses `Command.string`. `Command.string` resolves the Effect
**even on a non-zero exit code** — it only surfaces spawn failures, not git's
own error exit. So when HEAD is the root commit (`HEAD~1` does not resolve),
`git reset HEAD~1` exits non-zero, the failure is swallowed, `mixedResetHead()`
reports success, but the tree is unchanged.

The driver (`src/main.ts:61`) then re-gathers, still sees `gtd: transport` at
HEAD, re-resolves `transportReset`, and loops. After `MAX_EDGE_HOPS` (100,
`main.ts:19`) the driver fails with "edge loop exceeded 100 hops". The user sees
an opaque crash instead of either success or a clear diagnostic.

## Solution

### 1. `mixedResetHead()` must detect git failures and the root-commit case

Rewrite `mixedResetHead()` in `src/Git.ts` to:

- First check whether HEAD has a parent. Use
  `git rev-parse --verify --quiet HEAD~1` via `Command.exitCode` (mirroring the
  `isAncestor` pattern at `Git.ts:138` and `removePackageDir` at `Git.ts:203`).
  Exit code `0` ⇒ a parent exists; non-zero ⇒ HEAD is the root commit.
- If there is **no parent**, return `Effect.fail(new Error(...))` with a clear
  message, e.g.
  `"cannot reset transport commit: it is the repository root commit (no parent to reset to)"`.
  This converts the silent infinite loop into an immediate, descriptive failure
  surfaced by the driver.
- If a parent **exists**, run `git reset HEAD~1` via `Command.exitCode` (not
  `Command.string`) and fail when the exit code is non-zero, so any future reset
  failure also surfaces instead of being swallowed.

Concretely, follow this shape (matching the existing `Command.exitCode` call
sites that provide the `executor` layer and `mapError` to `Error`):

```ts
mixedResetHead: () =>
  Effect.gen(function* () {
    const parentCode = yield* Command.make(
      "git", "rev-parse", "--verify", "--quiet", "HEAD~1",
    ).pipe(
      Command.exitCode,
      Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
      Effect.mapError((e) => new Error(String(e))),
    )
    if (parentCode !== 0) {
      return yield* Effect.fail(
        new Error(
          "cannot reset transport commit: it is the repository root commit (no parent to reset to)",
        ),
      )
    }
    const resetCode = yield* Command.make("git", "reset", "HEAD~1").pipe(
      Command.exitCode,
      Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
      Effect.mapError((e) => new Error(String(e))),
    )
    if (resetCode !== 0) {
      return yield* Effect.fail(new Error(`git reset HEAD~1 failed (exit ${resetCode})`))
    }
  }),
```

### 2. Leave `hasCommits()` as-is

The original capture claimed `hasCommits()` (`Git.ts:91`) uses `Command.string`
and "effectively always returns `true`". That is incorrect: it already uses
`git rev-parse --verify HEAD` and `Effect.catchAll(() => false)`, so on a
no-HEAD repo the `rev-parse` errors at the spawn/`Command.string` layer
differently than a plain non-zero — but in practice the test suite and existing
behavior rely on the current shape, and it is unrelated to the transport crash.
No change here. (If a follow-up wants belt-and-suspenders robustness it can
switch `hasCommits` to `Command.exitCode` too, but that is out of scope for this
fix.)

## Cucumber scenario

Add a scenario to `tests/integration/features/transport.feature` covering the
root-commit case. The existing `createTestProject()` helper always seeds a
`chore: initial commit`, so `gtd: transport` is never the root there. To make a
root transport commit, add a new composable `Given` step that creates the
transport commit as the **very first** commit in a fresh, empty repo.

New step in `tests/integration/support/steps/common.steps.ts` (keep it generic,
content visible in scenario text, one step = one commit):

```gherkin
Given a root commit "gtd: transport" that adds "src/wip.ts" with:
  """
  export const wip = () => "carried across machines"
  """
```

Implementation (inline, mirroring the existing
`"a commit {string} that adds {string} with:"` step but `git init`-ing a fresh
empty repo first so the commit is the root):

- `mkdtempSync` a new dir (or reuse a fresh-empty-repo helper), `git init -q`,
  set `user.name`/`user.email`/`commit.gpgsign=false` (same config as
  `createTestProject`), write the file, `git add`, `git commit`.
- Set `this.repoDir` to it. This step replaces "a test project" — the scenario
  uses it directly so there is no preceding `chore: initial commit`.

Scenario (in `transport.feature`):

```gherkin
Scenario: A gtd: transport HEAD that is the repo root commit fails clearly
  Given a root commit "gtd: transport" that adds "src/wip.ts" with:
    """
    export const wip = () => "carried across machines"
    """
  When I run gtd
  Then it fails
  And stderr contains "root commit"
```

Use the existing `it fails` and `stderr contains {string}` assertions from
`common.steps.ts` — no new assertion steps needed.

## Edge cases

- **Root transport commit** — primary case: now fails fast with a descriptive
  error instead of looping to `MAX_EDGE_HOPS`.
- **Non-root transport commit** — unchanged: parent exists, `git reset HEAD~1`
  succeeds, work re-derives. The existing first scenario in `transport.feature`
  remains green and guards this path.
- **`git reset` fails for some other reason** — now surfaces as a failure (exit
  code checked) rather than a swallowed no-op.

## Constraints

- Reuse the established `Command.exitCode` + `Effect.provide(executor layer)` +
  `Effect.mapError(Error)` pattern (`isAncestor`, `removePackageDir`).
- Keep `Given` steps small, composable, and generic; expose file content in the
  scenario text (per AGENTS.md testing rules).
- Run `npm run test:e2e`, `npm run typecheck`, and `npm run lint` before
  considering the change done.
- Reflect the fix in the README if it documents transport / Git primitives.

no open questions — run gtd to plan
