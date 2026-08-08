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

`CONTEXT.md` is the glossary — the domain language this repo uses (process,
turn, step, capture, rest, gate vs guard, pattern vs edge). Read it before
naming anything, and keep it a glossary: architecture lives here and in module
doc comments, never there.

Read the code for the architecture — every module carries a doc comment
describing its own job. The two boundaries that are decisions rather than
description, and must be preserved:

- **`src/PatternMachine.ts` is pure.** Definition types, the pattern grammar,
  HEAD resolution, and the step decision. No git, no filesystem, no Effect —
  every export is a plain function of its arguments. Keep it that way.
- **Everything IO-shaped lives at the edge.** `src/Edge.ts` (git/templates),
  `src/SteeringMode.ts` (mode commands), `src/ReviewWindow.ts` (the checkout
  window). `src/program.ts` calls the edge; it never reaches into `GitService`
  directly. The review window and the steering-file gate are deliberately
  invisible to the pure engine — don't "simplify" them back into it.
- **The review window issues no whole-tree index WRITE, and every git index
  write tolerates `index.lock` contention.** gtd shares one worktree index with
  the reviewer's editor SCM, `gtd lsp`, and git-aware prompts, which all write
  the index to refresh their stat cache when the window's `git reset --mixed`
  wakes them. So `openReviewWindow` leaves new files UNTRACKED (never
  `git add --intent-to-add .` — that both lost the lock race and truncated
  discarded files to zero bytes), and all index writers in `src/Git.ts` go
  through `withIndexLockRetry`. Don't add a whole-tree index write to the window
  or a raw `exec` that bypasses the retry.

A workflow is DATA, not code: there is no engine-side wiring to trace when a
workflow's shape changes.

### Changing the workflow

gtd ships ONE bundled template, `src/workflows/unified.yaml`, as its BUILT-IN
DEFAULT — a state command with no `workflow:` configured falls back to it, so
gtd works out of the box with no config. `gtd init` seeds only
`vars.testCommand` + a `modes:` formatting suggestion, never the workflow.

To change what it does, edit `src/workflows/unified.yaml` (`entry:`/`machines:`,
each machine's `model`, each state's `actor`, exactly one content kind, `on`
edges, `retry`, `file`/`mode`, `reviewWindow`/`reviewBase`). It compiles through
the same `compileWorkflowConfig` a user's `.gtdrc` `workflow:` key goes through
(which flattens `entry:`/`machines:` via `src/Machines.ts`'s `flattenMachines`
before any per-state compilation), so it never needs its own logic. After
editing, update:

- **`src/workflows/templates.test.ts`** — the invariants the compiled template
  must keep (one `entry.default`, one review window, one review/fix entry, the
  two entry-file forks)
- **e2e feature files** that assert on the bundled template's shape (they set it
  up with the `Given the workflow` step —
  `tests/integration/features/default-workflow.feature` (simple flow),
  `unified-advanced-flow.feature` (advanced flow), `gtd-loop.feature`,
  `driver-json-status.feature`, `smoke.feature`, `validate.feature`,
  `init.feature`, `review-window.feature`, `initial-state-entry.feature`,
  `templates-vars.feature`, `entry-gate.feature` (the green-baseline gate on
  every entry), `fix-entry.feature` (`--entry fix-precheck`), `entry.feature`
  (`--entry <state>`), `entry-vars.feature`, `prompt-diff-ranges.feature`)

MACHINES, not individual states, are the unit of conversational identity: a
machine's own `model:` stamps every one of its `prompt` states, and its memory
scope (`src/PatternMachine.ts`'s `memoryScopeAt`/`src/Edge.ts`'s `memoryKeyFor`)
is keyed off its position in the machine tree, not off any per-state field. So
reviewing a workflow-shape change should also ask "which machine owns this
state's model and memory scope" — alongside, not instead of, the per-state
checks above.

A genuinely new engine capability (a new content kind, a new `on` pattern
grammar, a new state property) is a different, much rarer kind of change — that
touches `src/PatternMachine.ts` (types + `validateDefinition`),
`src/PatternConfig.ts` (the compiler), and `src/PatternTemplates.ts` or
`src/Edge.ts` as needed, plus all of the above.

A new steering-file FORMAT is neither: `mode:` names a pluggable mode, so a
workflow declares its own `modes:` entry (a `format:`/`validate:` shell command
pair) — no gtd change at all. Only the two built-in VALIDATORS (`qa`/`review`)
live in code, because `gtd lsp` needs their parsers in process; a third built-in
name, `prose`, is recognized with no code of its own — a format-only mode (no
validator) the simple flow's plan file uses. gtd ships no formatter at all
(there is no `gtd format` subcommand and no bundled prettier — a project plugs
its own into a mode's `format:`).

### Variables

The engine blesses NO variable NAMES. `testCommand` is the bundled template's
own `vars:` entry, workflow-authored data like any other `it.vars` key — not a
name gtd interprets. Don't add a blessed config key for one.

### Scripted checks (no in-process execution)

Checks are just an ordinary actor's turns at a `script`-content state (the
bundled template's `build.health.check` state, awaited by the `check` actor) —
**the engine NEVER executes anything itself**. `gtd next` renders and prints the
script; the DRIVER (`bin/gtd`, or any loop harness) executes it verbatim via
`bash`. The only place gtd spawns a subprocess at all is a steering-file mode's
own `format:`/`validate:` command.

Mechanics belong in the script; which `on` pattern the resulting diff matches is
the only thing that decides the outcome. In e2e, simulate a check's outcome by
writing the output file (e.g. `Given a file "FEEDBACK.md" with:`) and running
`gtd step check` — `@inmem` scenarios never execute scripts; only `@live`
scenarios actually run them.

## CLI design

`src/Cli.ts` owns the whole shell — one flag table, one command table, one
parser, one envelope. The table is the source of truth, not prose:

- A flag exists in the table (`name`, `arity`, `repeatable`, `scope`, `decode`,
  `scopeError`, `help`) or it does not exist — there is no flag recognized by
  some code path but absent from the table, and no unknown `--` option ever
  passes silently (a mistyped `--jsn` is a usage error, never a silent
  plain-text degrade)
- `renderHelp()` is a derived view of the flag/command tables, not
  hand-maintained prose — a flag or command's help text lives in its own row
  (`help`/`details`), and the README's `## Commands` block is pinned equal to
  `renderHelp()`'s output
- Adding an escape hatch (a new flag, a new command, a new scope exception) is a
  table edit, not a new `if` — `Cli.test.ts`'s property test forces every
  unrecognized `--` token to a usage error, so a flag added anywhere other than
  the table is invisible to the parser by construction
- `--version`/`--help` must stay unrepresentable as a `Command` — they resolve
  to an `output` plan, so no layer is ever built to answer them and no
  `run*Command` handler can accidentally gate on their presence
- gtd renders plain line output only — there is no spinner/renderer and no
  agent-event stream in the CLI. Do not re-add `--verbose`/`--debug` (or any
  output-mode flag) without wiring it to a real, tested concern; the flags must
  never exist only in the help text

## Step capture

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
- **Steering-file gate (edge, not engine):** capturing a commit out of a state
  that declares `file:`+`mode:` first formats that file in place and validates
  it per its `mode:` (`enforceSteeringGate` in `src/program.ts` over
  `src/SteeringMode.ts`), and REFUSES the step when it is invalid, so a
  malformed steering file is never committed (an agent's draft or a human's gate
  edit alike). It is a no-op when the file is absent (a deletion) or the state
  declares no `file:`/`mode:`, and a squash skips it
