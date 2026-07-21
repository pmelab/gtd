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
- `src/Workflow.ts` (`defaultWorkflow` — the machine's whole declarative shape:
  the `actors` declarations (name + interactive/autonomous kind), the `GtdState`
  type, the state's `StateDef` (awaited actor, prompt/model bindings, and its
  `captureRules` — which label a step commits, decided from the pending tree),
  its `turnRules` / `routingRules` rows, interrupt/fallback ladder rungs,
  counter rules, `conflicts`, `entry` rules, and `agentTurnValidation`)
- `src/Machine.ts` (the interpreter — usually untouched by a step change, but
  check the turn-taking carve-outs in `applyTurnTaking` for hardcoded
  subjects/states, e.g. the idle/health-fix same-chain re-tests)
- `src/Events.ts` (`gatherEvents` flag derivation, `perform`)
- `src/program.ts` dispatch
- `src/Prompt.ts` (template imports/registrations; `isPromptState` and the
  template/model selection read the `src/Workflow.ts` state defs)
- `src/State.ts` (`edgeActionHandlers` — a total map over `EdgeAction["kind"]`,
  so it won't fail to compile on a removed/added variant the way an
  exhaustive-switch-free table can silently drift)
- STATES.md / README.md / docs/ (especially docs/workflow.md and docs/cli.md)
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

Same pattern for the `invoker` actor (a declared actor name or `"none"`,
`src/Machine.ts`): it travels as a `ResolvePayload` field, not a Context tag,
because it's a pure-decision input consumed by the resolver's turn guards
(`applyTurnTaking`), not something every side effect needs to see.

Same pattern again for `decisionLog` (`src/Events.ts`): it's a per-prompt input
consumed only by the grilling/architecting templates, not a cross-cutting IO
mode, so it travels as a `ResolvePayload`/`ResolveContext` string field. Unlike
`squashDiff`/`turnDiff`, it isn't sourced from a single steering file —
`gatherEvents` scans the full first-parent commit history (reusing `allHistory`,
never a second `git log` spawn) for squash commits carrying a
`Gtd-Decisions: true` trailer, extracts each one's `## Decisions` section, and
concatenates them oldest to newest with **no deduplication**. This is
deliberate: grilling questions are freshly worded every cycle, so a later
cycle's answer to "the same" topic essentially never matches an earlier
`### <question>` heading verbatim — a mechanical key-based merge can't detect a
revisit, so conflict resolution is left to whichever prompt reads the text
(prefer the more recent entry) rather than attempted in code. Because completed
cycles' squash commits are immutable, this concatenated text is a stable,
append-only prefix across invocations — that shape is intentional: it's what
makes LLM prompt caching effective without an in-repo cache of our own.

### Review Checkout Window (Program-Edge Concern)

The review checkout window (`src/ReviewWindow.ts` — HEAD/index rewound to the
review base while `gtd: await-review` rests, so editors surface the diff) is
wired ONLY in `src/program.ts`: closed before `ConfigInit.ensure` and every
`gatherEvents`, re-armed after dispatch (success AND failure paths). The
machine, `gatherEvents`, and `perform` must never know it exists — no
`ResolvePayload` field, no `GtdState`, no Context tag. Anything that reads git
state through a new entry point must run AFTER the close hook, or it will
classify against the rewound HEAD.

### Agentic Cycle Counters (Trailer-Carried, Stamped at Write Time)

`testFixCount` / `reviewFixCount` / `healthFixCount` ride on the commits
themselves: every machine-written commit (turn AND label) carries its vector as
a `Gtd-Counters: t=N r=N h=N` body trailer, computed by the **writer** from the
previous vector plus the written label's stamp (`labelCounterStamps` /
`CaptureRule.stamp` in `src/Workflow.ts` — e.g. `test-failed` → t+1, a
findings/approval verdict turn → r+1, `building`/`close-package` → t=r=0).
`gatherEvents` (`src/Events.ts`) reads ONE trailer — the nearest workflow
commit's — into `payload.counters`; there is no fold over history, and a
trailer-less workflow commit (pre-trailer history) reads as the zero vector
(budgets restart — the documented upgrade rule). Squash commits carry NO trailer
(their message is the human-authored SQUASH_MSG.md verbatim) and are skipped as
boundaries. Hand-authored e2e histories that need a non-zero budget must spell
the trailer on their newest workflow commit
(`Given a commit "…" with counters "t=3 r=0 h=0"`).

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

- Turn capture is rule-driven (`captureRules` per state in `src/Workflow.ts`): a
  step of the awaited actor commits the first matching rule's LABEL, decided
  from the PENDING tree — branch outcomes (`grilling-accepted`,
  `review-approved`/`review-feedback`, `agentic-approved`/`agentic-findings`)
  are encoded in the label at capture, never re-derived from a landed turn's own
  diff (the δ(label, diff) discipline)
- **No matching rule = a no-op invocation** (zero commits) — inert empty steps
  are the DEFAULT; the loop protocol opens each iteration with `gtd step agent`
  BEFORE the agent acts, so a clean-tree step must author nothing. Empty-turn
  signals (human accept-defaults, clean approval, the environmental health fix)
  are opt-in `empty: true` rules, and an empty rule never re-fires while HEAD
  already carries the same turn (the fixpoint, as a label fact). When adding a
  gate, decide explicitly whether its empty turn is a signal (add an `empty`
  rule) or a no-op (add none)
