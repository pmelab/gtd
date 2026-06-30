# Fix the COMMIT-stream base so budgets engage on the default branch

## What to build

In `gatherEvents` (`src/Events.ts`, COMMIT-events section, ~lines 200-208), fix
the bug where the COMMIT stream range is empty on a trunk-based workflow.

On the default branch `merge-base(defaultBranch, HEAD) == HEAD`, so the range
`base..HEAD` is empty, `commitHistory` returns `[]`, and `foldCounters([])`
yields `{testFixCount: 0, reviewFixCount: 0}` — disabling both budgeted loops.

Mirror the guard the reviewBase block already uses: resolve HEAD's hash once at
the top of the COMMIT section, and discard the merge-base when it equals the
HEAD hash so the range falls back to whole-history (`base = undefined`).

Replace the current base resolution:

```ts
const defaultBranch = yield * git.resolveDefaultBranch()
const base = Option.isSome(defaultBranch)
  ? yield * git.mergeBase(defaultBranch.value, "HEAD")
  : Option.none<string>()
```

with a version that resolves `headHash` upfront and discards the merge-base when
it equals HEAD:

```ts
const defaultBranch = yield * git.resolveDefaultBranch()
const headHash =
  yield * git.resolveRef("HEAD").pipe(Effect.catchAll(() => Effect.succeed("")))
const mergeBase = Option.isSome(defaultBranch)
  ? yield * git.mergeBase(defaultBranch.value, "HEAD")
  : Option.none<string>()
// Discard the merge-base when it is HEAD itself (trunk-based workflow): the
// range main..HEAD would be empty and disable the budgets. Whole-history
// fallback is safe because foldCounters resets on every package boundary.
const base =
  Option.isSome(mergeBase) && mergeBase.value !== headHash
    ? mergeBase
    : Option.none<string>()
```

Then **deduplicate** the second `resolveRef("HEAD")` in the reviewBase block
(`src/Events.ts:300-302`): delete that local `headHash` resolution and reuse the
`headHash` now resolved at the top of the gen. The `mergeBaseCandidate`
expression at lines 301-302 should reference the hoisted `headHash`.

## Acceptance criteria

- [ ] `headHash` is resolved exactly once in `gatherEvents`, at the top of the
      COMMIT section, keeping the `catchAll(() => Effect.succeed(""))`
      empty-repo guard
- [ ] The COMMIT-stream `base` is `Option.none()` (whole-history) when the
      merge-base equals `headHash`, and the merge-base otherwise
- [ ] The reviewBase block (~line 300) no longer calls `resolveRef("HEAD")` a
      second time — it reuses the hoisted `headHash`
- [ ] On a feature branch the merge-base is still used as the COMMIT base (no
      behavior change)
- [ ] `bun run typecheck` (or the project's typecheck) passes
- [ ] The full existing test suite passes (`bun test` / the configured test
      command) — all current feature-branch budget scenarios remain green

## Files

- `/Users/pmelab/Code/gtd/gtd/src/Events.ts` (only this file)

## Constraints / edge cases

- `headHash === ""` (empty repo) never equals a real merge-base, so the guard is
  inert there; `commitHistory` already returns `[]` for a repo with no HEAD. Do
  not special-case it.
- Do NOT change `commitHistory`, `mergeBase`, `foldCounters`, the reset
  triggers, or the reviewBase precedence ladder. The merge-base remains the base
  on feature branches.
- No config-schema change. `fixAttemptCap` / `reviewThreshold` semantics are
  unchanged.
- This package adds no new tests (tests land in package 02); it must leave the
  suite green on its own.
