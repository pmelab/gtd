# Improve execute orchestration: name the next package, drop the cleanup round-trip

Review feedback on the one-package-per-cycle execute design:

> Instead of prompting to execute "exactly one package" (relying on the agent to
> pick the lowest-numbered package), gtd should emit a prompt that instructs the
> agent on the **specific** next package directly, to avoid misunderstandings.
> And when no more packages are left, it could directly emit the prompt for the
> next phase instead of requiring an extra cleanup cycle.

## Design

### 1. Name the next package directly

Today `execute.md` says "execute EXACTLY ONE package — the lowest-numbered
remaining in `.gtd/`" and relies on the agent to pick it from the Context
package listing. gtd already computes the sorted `packages` array in the edge
(`Events.ts` → `getPackages`), so it can pinpoint the next package and render an
execute prompt scoped to just that one — removing the "pick the lowest-numbered"
instruction and the full multi-package listing as a source of ambiguity.

This is a prompt-rendering change (`Prompt.ts` / `Events.ts` / `execute.md`),
not a machine change — the `execute` leaf still wins via `hasPackages`.

### 2. Drop the cleanup round-trip

Today the tail of a build is: execute last package → re-run → `cleanup` (delete
empty `.gtd/`) → re-run → `human-review`. The `cleanup` state exists only to
`rmdir` the empty directory. The feedback asks gtd to go straight to the next
phase when no packages remain.

### Implementation notes

- **Inline the next package's task files.** The edge reads the lowest-numbered
  package's task `.md` files (and notes its `COMMIT_MSG.md`) and inlines their
  full contents into the emitted execute prompt, so it is completely
  self-contained — the agent never opens `.gtd/` or chooses a package. This
  likely means `Events.ts` reads the task-file contents into the `packages` fact
  (or a dedicated field), and `Prompt.ts` / `execute.md` render the single
  scoped package. No machine change — `execute` still wins via `hasPackages`.
- **Execute deletes `.gtd/` on the last package.** When `packages.length === 1`
  at render time, the execute prompt instructs the agent to remove the empty
  `.gtd/` directory in the same step it commits the last package, so the next
  run resolves straight to `human-review`. The prompt is rendered differently
  for the last-package case (it knows it is the last). Keep the `cleanup` leaf
  in the machine as a vestigial safety net for a stray empty `.gtd/` (e.g. one
  created by hand) — do not remove it.

## Answered Questions

### How much of the next package should the emitted prompt embed?

**Decision:** inline the full contents of the next package's task files into the
emitted prompt (self-contained; no `.gtd/` browsing, no package selection).

### How should the cleanup round-trip be eliminated?

**Decision:** the execute prompt deletes the empty `.gtd/` when committing the
last package (gated on `packages.length === 1`), so the next run goes straight
to `human-review`. The `cleanup` leaf stays as a safety net — not removed.
