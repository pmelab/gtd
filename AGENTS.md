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
diff touched `.gtd/FEEDBACK.md` (or legacy root `FEEDBACK.md`) — a findings
round). Derived counters accumulate inside the state machine from event flags,
keeping the edge thin.

## CLI Design

- Keep CLI flags orthogonal: each flag controls exactly one concern and no flag
  implies another, so users can combine them freely
- Never let an unknown `--` option pass silently — reject it with a usage error
  (`--json` is the only long option in v2); a mistyped `--jsn` silently
  degrading to plain-text output is a bug class, not a convenience
- v2 renders plain line output only — there is no spinner/renderer and no
  agent-event stream in the CLI. Do not re-add `--verbose`/`--debug` (or any
  output-mode flag) without wiring it to a real, tested concern; the flags must
  never exist only in the help text

## Turn Capture

- An empty AGENT turn is inert at every gate whose move is a file artifact
  (`grilling`, `architecting`, `grilled`, `building`, `fixing`,
  `agentic-review`, `review`, and `squashing` while `SQUASH_MSG.md` is still the
  template) — the loop protocol opens each iteration with `gtd step-agent`
  BEFORE the agent acts, so a clean-tree capture there must author nothing. When
  adding a gate, decide explicitly whether its empty turn is a signal (human
  accept-defaults, health-fixing's environmental fix) or a no-op, and guard BOTH
  layers: `applyTurnTaking` (don't capture) and `classifyHead` (don't consume
  state for historical/crash-recovered empty turns)
