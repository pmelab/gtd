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

v3 ("the pattern machine" — see `docs/design/pattern-machine-plan.md`) deleted
the entire v2 definition model (gates, guard functions, actor kinds,
interrupt/fallback ladders, capture rules, turn/routing rules, counters,
conflicts, the review checkout window). A workflow is now just named states —
see [STATES.md](STATES.md) for the model. The sections below describe what
replaced the old machinery; if you're looking for `TurnGate`, `captureRules`,
`Gtd-Counters`, or `WorkflowConfig` guards, they no longer exist.

### Changing the Workflow

There is no engine-side wiring left to trace through when a workflow's shape
changes — a workflow (bundled default or custom) is DATA, not code. To change
what the bundled default does, edit `src/workflows/default.yaml` (states,
`actor`, exactly one content kind, `on` edges, `retry`, `model`) —
`src/workflows/ default.ts` compiles it through the same `compileWorkflowConfig`
a user's `.gtdrc` `workflow:` key goes through, so it never needs its own logic.
After editing the YAML, update:

- **STATES.md §10** — the bundled-default table and walkthrough
- **e2e feature files** that assert on the default workflow's shape
  (`tests/integration/features/default-workflow.feature`, `gtd-loop.feature`,
  `driver-run.feature`, `smoke.feature`)
- **`skills/loop/SKILL.md`** only if the change affects the driver contract
  itself (dispatch on `kind`, stall detection) — not the default workflow's own
  states, which the skill never names

A genuinely new engine capability (a new content kind, a new `on` pattern
grammar, a new state property) is a different, much rarer kind of change — that
touches `src/PatternMachine.ts` (types + `validateDefinition`),
`src/PatternConfig.ts` (the compiler), and `src/PatternTemplates.ts` or
`src/Edge.ts` as needed, plus all of the above.

### The Pattern-Machine Module Map

- **`src/PatternMachine.ts`** — the pure engine. Definition types
  (`WorkflowDefinition`, `StateDef`, `ContentKind`), the pattern grammar's
  parser (`parsePattern`) and matcher (`matchesPattern`/`globToRegExp`), HEAD
  resolution (`resolveState` — subject grammar + the closed-world actor check
  - initial-state fallback), the step decision (`step` — refusals, no-op,
    commit, squash, retry redirection via `applyRetry`), and
    `validateDefinition`. No git, no filesystem, no Effect — every export is a
    plain function of its arguments.
- **`src/PatternConfig.ts`** — compiles the raw `.gtdrc` `workflow:` YAML value
  into a `WorkflowDefinition` (`compileWorkflowConfig`): per-state field
  compilers, `./`/`../` file-reference auto-inlining, the `vars:` compiler
  (`compileVarsMap` — scalar coercion, object/array rejection; shared with
  `Config.ts`'s top-level `vars:` key so both layers validate identically),
  config-shape validation collected alongside `validateDefinition`'s findings.
- **`src/PatternTemplates.ts`** — Eta rendering (`renderStateTemplate`) over
  `TemplateContext`. Pure-ISH: every impure value (hashes, diffs, the `read`
  callback) is injected by the caller: this module never touches git or the
  filesystem.
- **`src/Edge.ts`** — the Effect edge: `resolveRest` (HEAD → state via
  `ConfigService.workflow` + `resolveState`), `computeProcessRun` (walks
  first-parent history for the current process's start/trace, stopping —
  EXCLUDING the boundary commit itself — at either a non-workflow commit or a
  workflow commit entering the definition's OWN initial state, e.g. the bundled
  default's `gtd(human): idle`; a workflow with no `commit:` state, like the
  bundled default, relies entirely on this initial-entry rule to keep one
  cycle's `retry` counts/diffs from pooling into the next),
  `buildTemplateContext`, `renderRest`, `executeDecision` (performs a `"commit"`
  or `"squash"` `StepDecision` — the only place a turn is actually written or a
  squash actually performed).
- **`src/program.ts`** — CLI dispatch (`step`/`next`/`run`/`status`/`format`).
  Calls `Edge.ts` for everything IO-shaped; calls `PatternMachine.ts`'s pure
  `step`/`matchesPattern`/`parsePattern` directly where no IO is needed (e.g.
  `gtd status`'s per-change pattern report).
- **`src/workflows/default.{yaml,ts}`** — the bundled default workflow, compiled
  through the exact same `compileWorkflowConfig` path — no privileged code path.
  Every content string in `default.yaml` MUST be inline (no `./`-relative file
  references): it ships inside the single-file `dist/gtd.bundle.mjs` build, so
  it can't reach out to sibling files on disk at runtime.

### The Configurable Machine (`workflow:` and `vars:` in .gtdrc)

`src/Config.ts`'s `ConfigService` reads `.gtdrc` (cosmiconfig, deep-merged
cwd→home), decodes it against `src/ConfigSchema.ts` (two keys: `workflow` and
`vars`, both `Schema.Unknown` — the shape is validated structurally by the
compiler, not by `effect/schema`), and compiles the `workflow:` value through
`compileWorkflowConfig`, or falls back to `defaultWorkflowDefinition`/
`defaultWorkflowVars` (`src/workflows/default.ts`) when the key is absent; the
top-level `vars:` value compiles through the same `compileVarsMap` (see
`Config.ts`'s `compileRcVars`). There is no module-global registry (no v2-style
`activeWorkflow()`/`setActiveWorkflow`):
`ConfigOperations { workflow, workflowVars, rcVars }` flows through the
`ConfigService` Context tag like any other Effect dependency, read fresh each
invocation — nothing to reset between tests. `src/Edge.ts`'s `resolveVars`
merges `workflowVars`/`rcVars` with a third layer — every `GTD_VAR_`-prefixed
entry of an injected `EnvVars` Context tag (mirroring `Cwd`/`WorktreeReader`,
never `process.env` read directly) — into the flat `Record<string, string>`
every template sees as `it.vars`. The engine still blesses NO variable NAMES:
`testCommand` (the bundled default's own `vars:` entry, read by `checking`'s
script) is workflow-authored data like any other `it.vars` key, not a name gtd
itself interprets.

The commit grammar's closed actor set still DERIVES from the active definition
(`declaredActors` in `src/PatternMachine.ts`), so custom actor names parse
exactly like built-in ones — same backward-compatibility mechanism as before,
generalized: any subject naming a state or actor outside the active workflow's
declared sets is inert and resolves to the initial state (see `resolveState`,
STATES.md §5). This is also the whole v1/v2/v3 upgrade story — nothing extra
needed to keep old history inert.

### The Scripted Check Actor (No In-Process Execution)

Checks are just an ordinary actor's turns at a `script`-content state (the
bundled default's `checking` state, awaited by the `check` actor) — the engine
NEVER executes anything itself. The command lives INLINE in that state's own
`script:` content (no BLESSED `testCommand` config key — see `docs/upgrading.md`
— though the bundled default's script does read its own `vars.testCommand`,
workflow-authored data like any other `it.vars` entry, not a name the engine
special-cases). `gtd next` renders and prints the script; `gtd run` is the only
place gtd spawns a subprocess: it executes the rendered script verbatim via
`bash`, then runs `gtd step <actor>` for that state's own actor to capture the
outcome from whatever the script left in the tree (e.g. an `on` pattern matching
`A .gtd/FEEDBACK.md` vs `C`). Mechanics belong in the script; which `on` pattern
the resulting diff matches is the only thing that decides the outcome — there is
no separate capture-rule layer to keep in sync. In e2e, simulate a check's
outcome by writing the output file (e.g. `Given a file "FEEDBACK.md" with:`) and
running `gtd step check` — `@inmem` scenarios never execute scripts; only
`@live` scenarios use `gtd run`.

## CLI Design

- Keep CLI flags orthogonal: each flag controls exactly one concern and no flag
  implies another, so users can combine them freely
- Never let an unknown `--` option pass silently — reject it with a usage error
  (`--json` is the only long option); a mistyped `--jsn` silently degrading to
  plain-text output is a bug class, not a convenience
- gtd renders plain line output only — there is no spinner/renderer and no
  agent-event stream in the CLI. Do not re-add `--verbose`/`--debug` (or any
  output-mode flag) without wiring it to a real, tested concern; the flags must
  never exist only in the help text

## Step Capture

- Capture is pattern-driven, not rule-driven: `PatternMachine.step` matches the
  awaited state's `on` patterns against the pending diff (first match wins) and
  commits the matched target verbatim as `gtd(<actor>): <target>` — there is no
  separate label/capture-rule layer to keep in sync with the diff; the pattern
  IS the rule. A branch outcome (an approval vs. feedback, a green vs. red
  check) is encoded by which pattern the AUTHORED diff happens to match, not by
  a rule re-deriving it after the fact
- **No matching pattern on a clean tree = a no-op invocation** (zero commits) —
  inert empty steps are the DEFAULT; the loop protocol opens each iteration with
  `gtd step <actor>` before the actor has acted, so a clean-tree step must
  author nothing unless the state explicitly declares a `C` pattern. When adding
  a state, decide explicitly whether its clean step is a signal (declare a `C`
  row) or a no-op (declare none)
- A dirty tree matching no declared pattern is a **refusal**, not a no-op —
  distinguish "nothing happened" (clean, no `C` row) from "something happened
  that nothing recognizes" (dirty, no row fires) when writing a new state's `on`
  map
