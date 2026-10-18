# Architecture: PR 401 review 3 — declared-tests guard follow-ups

**One code change in `src/workflows/feature/packages.ts` carries concerns 1–3;
concern 4 is a state-file chore.** Concern 1: a build turn whose diff shows a
marked test as `added` lands in a new `addedMarked` bucket. Concern 2: the
`turn` default goes away. Concern 3: a `seen` set means a path is pushed once.

- `diffBucket`: marked test, `turn === "build"`, status `"added"` →
  `"addedMarked"`. The existing `"modified"` → `"modifiedMarked"` stays. A fix
  turn returns `undefined` for both, as today. The existing early `continue` for
  a path also listed unmarked still runs first, so the unmarked entry wins
- New group, placed right after the modified group and before the deleted one:
  `marked (unchanged) but added by this turn — the marker promises an existing test; stop and leave it to a person`.
  **It never says delete, revert or restore**, because deleting the file trips
  "missing from the tree" next turn (the #373 loop)
- `requireDeclaredTests(pkg, since, turn)`: `turn` is required. The only
  production caller (`packageItem`) already passes it, so nothing else changes
  there
- Dedupe: before pushing, skip a path already in `seen`. The first bucket that
  claims a path keeps it. Only a duplicated `## Tests` line can repeat a path,
  and both copies always land in the same bucket, so which one wins does not
  matter
- Build prompt (`src/workflows/shared/text.ts`, build turn's `(unchanged)`
  bullet) and README step 3: a marked test must exist before the turn, and the
  build turn must not create, edit or delete it

## Interfaces

```ts
// src/workflows/feature/packages.ts
export type DeclaredTestsTurn = "build" | "fix"

// `turn` has no default any more; every caller names it.
export const requireDeclaredTests: (
  pkg: string,
  since: string,
  turn: DeclaredTestsTurn,
) => void

// Refusal groups, in output order (the wording of the existing four is unchanged):
//   "not in the package's diff — write them"
//   "marked (unchanged) but modified — revert them"
//   "marked (unchanged) but added by this turn — the marker promises an existing test; stop and leave it to a person"   // new, build turn only
//   "marked (unchanged) but deleted — restore them"
//   "missing from the tree"
// Each path appears at most once in the whole message.
```

## Call Stacks

- `gtd land` (build turn) → `packages` → `packageItem` →
  `declared(build, "build")` → `requireDeclaredTests(pkg, from, "build")` →
  `changesSince` / `read` → `refuse`
- `gtd land` (fix turn) → `healthy` → `declared(fixSuite, "fix")` →
  `requireDeclaredTests(pkg, from, "fix")` → `refuse` (added marked test not
  refused)
- build prompt render → `text.ts` build turn template → the `(unchanged)` rule
  bullet

## E2E Scenarios

- e2e: tests/integration/features/declared-tests.feature — a build turn that
  creates a file its package lists as `- unit: \`lib/new.test.ts\`
  (unchanged)`fails`gtd land`; stderr names the path and says "stop and leave it
  to a person" (covers 1)
- e2e: tests/integration/features/declared-tests.feature — a build turn that
  creates a file listed both unmarked and marked `(unchanged)` succeeds and
  advances to the health check (covers 1)

## Unit Tests

### requireDeclaredTests

- unit: src/workflows/feature/packages.test.ts — build turn, marked test with
  status `added` → refused under "added by this turn … stop and leave it to a
  person"; message holds no "delete", "revert" or "restore" (covers 1)
- unit: src/workflows/feature/packages.test.ts — replaces "does not call a
  marked test the build added modified": an added marked test is refused as
  added, never as modified (covers 1)
- unit: src/workflows/feature/packages.test.ts — fix turn, marked test with
  status `added` → no refusal (covers 1)
- unit: src/workflows/feature/packages.test.ts — build turn, path listed both
  unmarked and marked, status `added` → no refusal (covers 1)
- unit: src/workflows/feature/packages.test.ts — group order is write, revert,
  added, restore, missing (extends the existing order test) (covers 1)
- unit: src/workflows/feature/packages.test.ts — every call in the suite passes
  `turn` explicitly; the test helper calls
  `requireDeclaredTests(pkg, "c", turn)` with no defaulted turn reaching the
  guard (covers 2)
- unit: src/workflows/feature/packages.test.ts — a `## Tests` line duplicated
  verbatim, unwritten → the path appears exactly once in the message; same for a
  duplicated marked line that is missing from the tree (covers 3)

### Build prompt text

- unit: src/workflows/shared/text.test.ts — the build prompt says a marked test
  must exist before the turn and the turn must not create, edit or delete it,
  and keeps "stop and leave it to a person" (covers 1)

### Chores

- chore: src/workflows/feature/packages.ts — drop `= "fix"` from `turn`; update
  the JSDoc to say the build turn must neither modify nor add a marked test
  (covers 2, 1)
- chore: README.md — step 3 states a marked test must exist before the build
  turn, which must not create, edit or delete it (covers 1)
- chore: .gtd/TODO.md — the three `## Deferred review notes` blocks (836985b,
  daed27f, eda53bb) are dismissed, not built; they leave with this process's
  `.gtd/TODO.md` and nothing in the code changes for them (covers 4)

## Merged Concerns

### 1 + 2 + 3 → one package on `src/workflows/feature/packages.ts`

All three change `requireDeclaredTests` and its test file; splitting them gives
three packages editing the same function.

- **1. Refuse a build turn that adds a test marked (unchanged) — PRODUCT.** A
  build turn that creates a file the package marks `(unchanged)` is refused, not
  only one that modifies or deletes it. The marker promises an existing test; a
  test the turn wrote breaks that promise. Today an added marked test passes
  because it exists in the tree. Scope: build turn only; fix turns keep today's
  behaviour. The unmarked entry still wins when a path is listed both marked and
  unmarked — that file is written by the package, adding it is fine. The refusal
  names the broken promise and tells the builder to stop and leave it to a
  person — its own group, never "delete it": deleting trips "missing from the
  tree" next turn, a #373-style ping-pong. The turn stays refused until a human
  fixes the package; wording matches the build prompt's "if the marker is wrong
  … stop and leave it to a person". The build prompt and README state the new
  rule: a marked test must exist before the turn, and the turn must not create,
  edit or delete it. New `@inmem` scenario in
  `tests/integration/features/declared-tests.feature`: a build that adds a test
  marked (unchanged) is refused; unit cases beside the guard.
- **2. Make the guard's turn parameter required — TECHNICAL.**
  `requireDeclaredTests` takes its turn (`"build"` | `"fix"`) with no default.
  Today it silently defaults to `"fix"`, the looser rule, so a new caller that
  forgets it skips the build-only checks. Every caller and test passes it
  explicitly.
- **3. List each refused path once — PRODUCT.** A path appears at most once in a
  refusal message. Today a path declared twice under `## Tests` is pushed twice
  and printed twice. Deduplicate within and across groups; group order and
  wording otherwise unchanged. Unit test covers a duplicated entry.

## Answered Questions

### Does the "added" refusal also apply to fix turns?

No — settled in requirements: fix turns may still touch a marked test, as
decided in 08eaee9.

### Which duplicates does "list each refused path once" cover?

Any repeat of one path in the message; a duplicated `## Tests` line is the only
source, so one `seen` set settles it.

### Do the deleted deferred review notes get folded into this work?

No — dismissed; they concern unrelated code and leave with `.gtd/TODO.md`.

### What should the refusal tell a builder who created a test marked (unchanged)?

Name the broken promise and say to stop and leave it to a person, in its own
group — the human's pick.

### Where does the new "added" group sit in the message?

Right after "modified — revert them": both are build-turn-only breaches of the
marker, and the existing order stays otherwise unchanged as concern 3 requires.

### How is "added" detected?

From the diff status `"added"` that `changesSince(since)` already returns; no
new port or tree read is needed.

### Which bucket keeps a path that reaches the list twice?

The first one. Duplicates come only from repeated `## Tests` lines, which always
land in the same bucket, so the choice never changes the output.

### May the unit-test helper keep its own default turn?

Yes, if it passes `turn` explicitly to `requireDeclaredTests`; the requirement
targets the guard's signature, and the type checker rejects any call that omits
it.
