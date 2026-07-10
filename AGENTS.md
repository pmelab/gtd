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

- `src/Subjects.ts` closed sets (`TurnGate`, `RoutingPhase`, `ROUTING_SUBJECT`)
- `src/Machine.ts` (the `GtdState` type, `resolveBaseline` / `classifyHead`
  rest/mid-chain classification table, `awaitedActor`, `predictTurn`)
- `src/Events.ts` (`gatherEvents` flag derivation, `perform`)
- `src/program.ts` dispatch
- `src/Prompt.ts` (`isPromptState`, `MODEL_STATE`, templates)
- STATES.md / README.md
- All feature files

Any `gtd: *` subject outside the closed v2 grammar (`src/Subjects.ts`) is an
inert boundary commit — removed subjects are simply dropped from the closed
sets, never routed. This is also how v2 stays backward compatible with v1
history: old v1 subjects fall outside the closed sets and parse as boundary
commits rather than errors.

### Mode Flags (Effect Dependency Graph)

- Follow the `QuietMode` pattern (Context tag + `static layer`) for any new
  boolean mode flags that need to flow through the Effect dependency graph

### Config Values vs. Mode Flags: `agenticReview` / `reviewThreshold`

`agenticReview` and `reviewThreshold` are read from `ConfigService` at the
Effect edge (`gatherEvents` in `src/Events.ts`) and passed to the pure machine
as `ResolvePayload` fields (`agenticReviewEnabled`, `reviewThreshold`) — NOT as
a `Context`-tag layer.

**Rule of thumb**:

- Render/IO modes (cross-cutting, affect how side effects behave everywhere) →
  `QuietMode` Context tag + `static layer`
- Pure-decision inputs (consumed by a guard on a specific resolve event, not
  needed elsewhere) → field on the `ResolvePayload`

`agenticReview` is a per-resolve guard input, not a cross-cutting IO mode, so it
travels as payload rather than as a Context service.

Same pattern for the `invoker` actor (`"human" | "agent" | "none"`,
`src/Machine.ts`): it travels as a `ResolvePayload` field, not a Context tag,
because it's a pure-decision input consumed by the resolver's turn guards
(`applyTurnTaking`), not something every side effect needs to see.

### Agentic Cycle Count Fold

`testFixCount` / `reviewFixCount` / `healthFixCount` are **folded in the
machine** (`foldCounters` in `src/Machine.ts`) from flags `gatherEvents`
(`src/Events.ts`) attaches to each `CommitEvent` — `isPackageStart`,
`isFeedback`, `isErrors`, `isHealthCheck`, `removedErrors` — not recomputed at
the Effect edge. `reviewFixCount` (the agentic-review cycle count) resets on
`isPackageStart` and increments on `isFeedback` (an agentic-review turn whose
diff touched FEEDBACK.md — a findings round). Derived counters accumulate inside
the state machine from event flags, keeping the edge thin.

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
