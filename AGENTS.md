## Testing

- `npm run test:mutation` is a deliberate user action — never run it
  autonomously; it takes 10+ minutes and is only meaningful when triggered on
  purpose
- create cucumber.js scenarios for each new feature
- use composable "Given" steps (small, reusable steps) instead of one-off setup
  steps
- make Given steps generic and expose actual file content/changes in scenario
  text — don't hide setup behind abstract step names
- inline setup logic into step definitions rather than chaining helpers; each
  step maps to one commit

## Architecture

### Removing a Workflow Step

When removing a step from a linear workflow (e.g. plan → build → learn →
cleanup), trace **every** reference before deleting:

- Step type definition
- `inferStep` logic
- `gatherState` inputs
- CLI `runStep` dispatch
- Commit prefix mapping
- Config schema
- Prompts / decision tree labels
- All test files

When a commit prefix maps to a removed step, keep it recognized in the type
system for backward compatibility but route it to `"idle"` — removing it
entirely risks breaking existing repos that have those commits in history.

### Mode Flags (Effect Dependency Graph)

- Follow the `QuietMode` pattern (Context tag + `static layer`) for any new
  boolean mode flags that need to flow through the Effect dependency graph

### Config Values vs. Mode Flags: `agenticReview` / `agenticReviewMaxCycles`

`agenticReview` and `agenticReviewMaxCycles` are read from `ConfigService` at
the Effect edge (`gatherEvents` in `src/Events.ts`) and passed to the pure
machine as `ResolvePayload` fields (`agenticReviewEnabled`, `maxAgenticCycles`)
— NOT as a `Context`-tag layer.

**Rule of thumb**:

- Render/IO modes (cross-cutting, affect how side effects behave everywhere) →
  `QuietMode` Context tag + `static layer`
- Pure-decision inputs (consumed by a guard on a specific resolve event, not
  needed elsewhere) → field on the `ResolvePayload`

`agenticReview` is a per-resolve guard input, not a cross-cutting IO mode, so it
travels as payload rather than as a Context service.

### Agentic Cycle Count Fold

The agentic cycle count and convergence status are **folded in the machine**
from flags on `COMMIT` events (`isAgenticReview` / `isAgenticApproved` /
`isWorkflowCommit`), not recomputed at the Effect edge. This mirrors the
`Gtd-Test-Fix:` verify-counter fold: derived counters accumulate inside the
state machine from event flags, keeping the edge thin.

### Stdout / Newline Handling

- `ensureNewline` only flushes a `\n` when the state it tracks is `dirty`; any
  code that writes to stdout directly (bypassing the handler) must also update
  that dirty state, or the next line will be appended without a separator
- When adding a `rendererDirty` guard, verify it is read inside every exit path
  of the renderer (`succeed`, `fail`, `setText`, etc.) — missing a single call
  site silently reintroduces the missing-newline bug for that transition

## CLI Design

- Keep CLI flags orthogonal: `--verbose` and `--debug` must never imply each
  other; each flag controls exactly one concern so users can combine them freely

## Event Handler

- Gate every user-visible stdout write inside `createEventHandler` behind the
  `verbose` flag — both `ThinkingDelta` and `ToolStart` (and any future event
  type) must be suppressed together; a partially-silent handler leaks noise
