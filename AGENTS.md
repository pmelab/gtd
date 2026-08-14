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
- README.md's "A complete minimal driver" section is DOC-TESTED, not just prose:
  `tests/integration/features/readme-driver.feature` extracts its fenced bash
  block verbatim (`tests/integration/helpers/readme-driver.ts`) and runs it as a
  real driver. The heading text and the single fence are load-bearing — renaming
  the heading or splitting the paste across more than one fence fails the
  extraction, not just a stale doc. The extracted script is spawned with only
  `$PATH` (a shim dir first) and `$HOME` — any new env dependency the paste
  grows must be documented in its own Prerequisites section, and is a scenario
  failure until it is

### Task graph and caching

`npm test` runs through Turborepo (`turbo.json`), not a serial `&&` chain — each
check is a task with its own `inputs`, so it's cached (skipped when its inputs
are unchanged since the last green run) and run in parallel with the others. Two
rules a future change must not break: adding a check means adding all three of a
`package.json` script, a `turbo.json` task with an explicit `inputs` array, and
that task's name to the `test` script's task list — a task missing any of the
three fails `tests/tooling/turbo.test.ts`. And under-declared `inputs` cache a
stale green: the canonical example is `README.md` in both e2e tasks' `inputs`,
because `tests/integration/features/readme-driver.feature` runs it as executable
code — omitting it would let a broken doc pass on a cached result.

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
  every export is a plain function of its arguments. Keep it that way. Pure
  means no IO — no git, no filesystem, no Effect; its one import is
  `src/StateFields.ts`, the state-field table, itself a zero-import leaf of
  const data and total functions.
- **Everything IO-shaped lives at the edge.** `src/Edge.ts` (git/templates),
  `src/SteeringMode.ts` (mode commands), `src/ReviewWindow.ts` (the checkout
  window), `src/StepGuards.ts` (the step-capture guard registry),
  `src/RepoFiles.ts` (the working-tree/committed content port),
  `src/CommandRunner.ts` (the subprocess port). There is no driver-scoped
  git-dir write left at all: `src/Sessions.ts`'s `sessionId`/`resume` are a pure
  derivation of history (`uuidv5` of the resting state's memory key) and write
  nothing; no command — `next`, `status`, or `land` — touches the git dir to
  record that a beat was dispatched. Every write gtd causes happens inside a
  script it emitted and the driver ran — the review window's own
  `git reset --mixed` open and close, and the squash finale's soft reset: those
  are the driver running an emitted script, not a command reaching into git
  itself. A command resolves ONE `Rest` (`Edge.ts`'s `currentRest`/`restAt`) and
  hands it to `planStep`/`planEntry` — `src/program.ts` never reaches into
  `GitService` directly except two narrow exceptions: the `abandon`/`restore`
  hard/mixed resets (recovery commands that must work even when a `Rest` would
  refuse — see `runAbandonCommand`'s own doc comment), and the review sign-off/
  feedback-progress gates' own `readFileAtRef` reads (they need the COMMITTED,
  pre-turn copy of a file, which a `Rest` snapshot — taken before the turn lands
  — doesn't carry). The review window and the steering-file gate are
  deliberately invisible to the pure engine — don't "simplify" them back into
  it.

- **The review window issues no whole-tree index WRITE, and every git index
  write tolerates `index.lock` contention.** gtd shares one worktree index with
  the reviewer's editor SCM, `gtd lsp`, and git-aware prompts, which all write
  the index to refresh their stat cache when the window's `git reset --mixed`
  wakes them. So `openReviewWindow` leaves new files UNTRACKED (never
  `git add --intent-to-add .` — that both lost the lock race and truncated
  discarded files to zero bytes). The `index.lock` retry is a property of the
  `GitOperations` PORT (`src/Git.ts`'s `withIndexLockRetries`), applied ONCE
  above the whole service — both `GitService.Live` and the in-memory layer
  (`src/testing/Layers.ts`'s `gitTestLayer`) build their service through it, so
  a raw `exec` added inside a writer can no longer bypass it. Never construct a
  `GitOperations` and hand it straight to `Layer.succeed` — go through
  `withIndexLockRetries`.

- **Because the window un-tracks things, `changedPaths` answers by CONTENT, not
  by the index: a path that EXISTS in the working tree is never reported `D`.**
  The window's `git reset --mixed` leaves every file the reviewed range added
  untracked-but-present, and `git diff --name-status <base>` compares `base` to
  the INDEX — so the index view calls each of them deleted. That phantom `D`
  made the review-signoff guard refuse every sign-off in a repo whose
  `reviewFile` sits outside `.gtd/` (the one directory the window pins back into
  the index). `src/Git.ts`'s `classifyUntracked` therefore classifies each
  untracked path against the base tree by blob id: absent → `A`, different →
  `M`, identical → no change. Don't "simplify" it back to the index's answer.
  The worktree side is hashed WITH the repo's clean filters (plain
  `git hash-object -- <paths>`, which looks each file's attributes up from its
  own path) — never `--no-filters`, or a `text=auto` repo reports every
  untouched CRLF file `M`, and a spurious `M` on the review doc is a spurious
  `hasCodeChange`, i.e. the same inert guard as above. The in-memory double has
  always compared the base tree to the worktree directly, so only the Live tier
  of `runGitServiceContract`'s `changedPaths` base-case group can fail on this —
  and an @inmem e2e scenario cannot (hence `@live`
  `review-window-untracked.feature`).

- **No emitted script moves HEAD.** `unified.yaml`'s `unwind` state reverts the
  entry commit's diff (`git revert --no-commit`) before planning ever starts, so
  by the time `start-gate.check` runs, the working tree already IS the baseline
  — one plain suite run there is the baseline verdict, the same rule
  `review-gate`/`fix-precheck` already followed. There is no second suite run,
  no detached checkout, no branch-restore trap, and no `SIGKILL` recovery story
  to document, because nothing ever leaves the branch. The untracked environment
  (`node_modules`, `.env`, build caches) is preserved for free the same way it
  always was — those paths were never in the entry commit to begin with, so
  reverting that commit doesn't touch them.

### Testing

`src/testing/` is the in-memory git/config/filesystem test seam
(`InMemRepo`/`GitDoubles`/`Layers`/`GitTiers`) — it never ships (a lint rule and
a build-time bundle-content assertion both guard the boundary) and is imported
only from `src/**/*.test.ts` and `tests/**`. The fake is trustworthy only
because `src/testing/GitTiers.ts`'s `runGitServiceContract` runs the same
20-operation `GitOperations` contract against BOTH the fake and a real git repo
— treat the contract, not the fake's internals, as the source of truth when the
fake and production ever disagree.

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
before any per-state compilation), so it never needs its own logic. A state's
`mode:` must name an entry the workflow's own top-level `modes:` map declares
(an empty `{}` entry is enough) — the compiler seeds `qa`/`review` for you, but
any OTHER name (including `prose`) needs its own `modes:` entry, or
`validateDefinition` rejects the state at load time. After editing, update:

- **`src/workflows/templates.test.ts`** — the invariants the compiled template
  must keep (one `entry.default`, one review window, one review/fix entry, the
  single `idle` edge into `start-gate.check`, the two `questionGate` instances,
  the `design`/`architecture` scope split)
- **e2e feature files** that assert on the bundled template's shape (they set it
  up with the `Given the workflow` step —
  `tests/integration/features/default-workflow.feature`,
  `readme-driver.feature`, `driver-json-status.feature`, `smoke.feature`,
  `validate.feature`, `init.feature`, `review-window.feature`,
  `initial-state-entry.feature`, `templates-vars.feature`, `entry-gate.feature`
  (the green-baseline gate on every entry), `fix-entry.feature`
  (`--entry fix-precheck`), `entry.feature` (`--entry <state>`),
  `entry-vars.feature`, `prompt-diff-ranges.feature`, `land.feature` (the
  exit-code contract: 0/3/settled/1; `readme-driver.feature`'s own
  `--entry fix-precheck` collapse scenario asserts on the bundled template's
  shape too)
- A workflow change must keep the DRIVER contract true, not just the engine's:
  every state a process can rest at must resolve to exactly one `kind` a driver
  already handles (`capture`/`message`/`script`/`prompt`/`stalled`) — there is
  no sixth kind to add without changing every driver in the world. In practice
  that means: a new `prompt` state must be able to terminate (a `C` row, a
  `retry:` cap, or an outcome its `on` rows actually match) or it stalls
  forever; a new `script` state with no `C` row settles the loop rather than
  advancing it; and a new `human` state's `on` rows must match whatever edit the
  human is being asked to make, or their capture beat is a refusal

MACHINES, not individual states, are the unit of conversational identity: a
machine's own `model:` stamps every one of its `prompt` states, and its memory
scope (`src/PatternMachine.ts`'s `memoryScopeAt`/`src/Edge.ts`'s `memoryKeyFor`)
is keyed off its position in the machine tree, not off any per-state field. So
reviewing a workflow-shape change should also ask "which machine owns this
state's model and memory scope" — alongside, not instead of, the per-state
checks above.

A genuinely new engine capability (a new content kind, a new `on` pattern
grammar) is a different, much rarer kind of change — that touches
`src/PatternMachine.ts` (types + `validateDefinition`), `src/PatternConfig.ts`
(the compiler), and `src/PatternTemplates.ts` or `src/Edge.ts` as needed, plus
all of the above.

A new STATE PROPERTY is not one of these anymore: it's one entry in
`src/StateFields.ts`'s `STATE_FIELDS` table plus its behaviour (a bespoke
checker or compiler only if the field's rule doesn't fit the table's generic
`nonEmpty`/`commit`/`requires` shape) — declaration, compilation, validation,
the editor JSON schema, and the visualizer's presentation all derive from that
one table and need no separate edit. Read `STATE_FIELDS` for what a state may
declare and how each field behaves, rather than any one derivation site.

A new steering-file FORMAT is neither: `mode:` names a pluggable mode, so a
workflow declares its own `modes:` entry (a `format:`/`validate:` shell command
pair, or `{}`) — no gtd change at all. Only the two built-in VALIDATORS
(`qa`/`review`, `src/SteeringFormats.ts`'s registry) live in code, because
`gtd lsp` needs their parsers in process; `src/PatternConfig.ts`'s compiler
seeds both of their names as empty `modes:` entries into every compiled
definition, so a workflow gets their validation without declaring them itself.
An empty `modes:` entry (`{}`) is the FORMAT-ONLY tier any workflow can use for
a name with no gtd-side schema — e.g. a workflow could declare
`modes: { prose: {} }` for a free-form steering file it wants no in-process
validation for. gtd ships no formatter at all (there is no `gtd format`
subcommand and no bundled prettier — a project plugs its own into a mode's
`format:`).

### Variables

The engine blesses NO variable NAMES. `testCommand` is the bundled template's
own `vars:` entry, workflow-authored data like any other `it.vars` key — not a
name gtd interprets. Don't add a blessed config key for one.

### Scripted checks (no in-process execution)

Checks are just an ordinary actor's turns at a `script`-content state (the
bundled template's `build.health.check` state, awaited by the `check` actor) —
**the engine NEVER executes anything itself**. `gtd next` renders and prints the
script; the DRIVER (the README's minimal driver, your own, or any loop harness)
executes it verbatim via `bash`. The only place gtd spawns a subprocess at all
is a steering-file mode's own `format:`/`validate:` command.

Mechanics belong in the script; which `on` pattern the resulting diff matches is
the only thing that decides the outcome. In e2e, simulate a check's outcome by
writing the output file (e.g. `Given a file "FEEDBACK.md" with:`) and running
`gtd land` — `@inmem` scenarios never execute scripts; only `@live` scenarios
actually run them.

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
- A command's preconditions live in `src/program.ts`'s `needsOf` table, not
  scattered `if`s: `needs: "state"` means a repository root **and** at least one
  commit, both enforced once in `runCommand` ahead of dispatch — no rest
  resolver downstream carries its own commitless branch

## Step capture

- Capture is pattern-driven, not rule-driven: `PatternMachine.step` matches the
  awaited state's `on` patterns against the pending diff (first match wins) and
  commits the matched target verbatim as `gtd(<actor>): <target>` — there is no
  separate label/capture-rule layer to keep in sync with the diff; the pattern
  IS the rule. A branch outcome (an approval vs. feedback, a green vs. red
  check) is encoded by which pattern the AUTHORED diff happens to match, not by
  a rule re-deriving it after the fact
- **No matching pattern on a clean tree = a no-op invocation** (zero commits) at
  a `script`/`message` rest — inert empty steps are the DEFAULT there. A driver
  lands a `script`/`message` beat it did dispatch, but a clean tree at one means
  the actor genuinely produced nothing, so a clean-tree step must author nothing
  unless the state explicitly declares a `C` pattern. A `prompt` rest is the ONE
  exception: a clean tree with no `C` row there commits an EMPTY
  `gtd(<actor>): <state>` ATTEMPT instead of a no-op (`PatternMachine.step`'s
  `attempt: true`, `StepCommit`'s own doc comment) — a fruitless agent dispatch
  costs money and must be remembered across restarts (`Edge.ts`'s `stalledAt`),
  unlike a fruitless check/gate. When adding a state, decide explicitly whether
  its clean step is a signal (declare a `C` row), an attempt (a `prompt` state's
  default), or a no-op (a `script`/`message` state declaring no `C` row)
- A dirty tree matching no declared pattern is a **refusal**, not a no-op —
  distinguish "nothing happened" (clean, no `C` row) from "something happened
  that nothing recognizes" (dirty, no row fires) when writing a new state's `on`
  map
- **Step-capture guards (edge, not engine):** `enforceStepGuards` in
  `src/StepGuards.ts` runs a registry of four guards before a normal commit
  lands — the review-signoff, feedback-progress, answer-completeness, and
  require-revert guards each check their own state-flavor condition. A state's
  `file:`+`mode:` formatting and validation is NOT a guard any more:
  `program.ts`'s `steeringModeSteps` emits the mode's own `format:`/`validate:`
  commands (over `src/SteeringMode.ts`) into the step script for the driver to
  run, ahead of the commit. Any guard REFUSES the step when its condition fires,
  so e.g. a malformed steering file is never committed (an agent's draft or a
  human's gate edit alike). Each guard is a no-op when it doesn't apply to the
  resting state (see `StepGuard.appliesTo`), and the whole registry is skipped
  for a squash/no-op decision, or an ATTEMPT (there is nothing to guard in an
  empty diff, and a `format:` run must not dirty an attempt and break the
  empty-diff derivation `stalledAt` relies on). The emitted format/validate pair
  is skipped for an attempt for the same reason, AND for a step whose diff
  DELETES that `file:` (`deletesFile`, shared with the guards): deleting it is a
  legitimate outcome — a review sign-off's whole diff is the review doc's
  deletion — and a `format:` like `prettier --write` exits non-zero on a missing
  path, which aborted the whole `set -euo pipefail` script before the commit and
  made the step unlandable
- **Two properties of a guard's INPUTS, each of which makes a guard silently
  INERT rather than loudly wrong when broken:** the pre-turn copy of a `file:`
  is read at `Rest.windowHead` — the open review window's saved head — never at
  real `HEAD`, which the window has rewound to the review base, where a file the
  process itself wrote does not exist yet; and `hasCodeChange` ("the human
  edited something real") excludes the state's OWN `file:` by exact path, and
  gtd's own plumbing by the DECLARED directory read off `it.stateDir`
  (`src/StepGuards.ts`'s `isCodePath`/`isPlumbingPath`), never a literal `.gtd/`
  prefix check. A `reviewFile` repointed to the repo root is still a steering
  file — the same assumption issue #128 broke in `deciding`'s check script — and
  a plumbing directory relocated via `vars.stateDir` is still plumbing. With
  either exemption wrong, the review sign-off guard takes its it-is-a-comment
  branch on every pass and the unticked-box check is unreachable
- The require-revert guard's own version of the same INPUTS risk: it compares
  the current tree against `reviewBase~1` intersected with the human's own
  review-round commit's touched paths, and it exempts the state's own `file:` by
  exact path and gtd's own plumbing by the same declared `it.stateDir` directory
  (never a literal `.gtd/` prefix). Get the comparison direction wrong (matching
  against `reviewBase` instead of its parent) and the guard is INERT — it allows
  every un-reverted tree; get either exemption wrong (a `.gtd/`-prefix check
  instead of the exact path on a `reviewFile` repointed to the repo root, or a
  literal `.gtd/` instead of the declared `stateDir` on a relocated plumbing
  directory) and it REFUSES every note-only round, or every round that touches
  the relocated directory, forever. `it.stateDir` is canonical BY VALIDATION —
  `src/Edge.ts`'s `renderStateDirOrFail` refuses a non-canonical spelling before
  any guard ever sees it — so this comparison, like every other consumer, must
  never re-normalize the value itself. The `deciding` script's own
  plumbing/reviewFile exclusion (`src/workflows/unified.yaml`) is a LITERAL path
  test agreeing with `isCodePath`/`isPlumbingPath` — the script's own two
  pathspecs use git's `:(exclude,literal)` magic rather than a glob or grep (the
  step guards themselves are plain string comparisons, not pathspecs), alongside
  the same "never a literal `.gtd/`" rule above
