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
- `docs/driver.md`'s "A complete minimal driver" section is DOC-TESTED, not just
  prose: `tests/integration/features/driver-doc.feature` extracts its fenced
  bash block verbatim (`tests/integration/helpers/driver-doc.ts`) and runs it as
  a real driver. The heading text and the single fence are load-bearing —
  renaming the heading or splitting the paste across more than one fence fails
  the extraction, not just a stale doc. The extracted script is spawned with
  only `$PATH` (a shim dir first) and `$HOME` — any new env dependency the paste
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
stale green: the canonical example is `docs/**` in `test:unit` and both e2e
tasks' `inputs`, because `tests/integration/features/driver-doc.feature` runs
`docs/driver.md` as executable code — omitting it would let a broken doc pass on
a cached result.

### `.gtd/` is formatted, not ignored

`.gtd/` carries no `.prettierignore` entry — every file under it, steering files
included, is oxfmt-formatted and covered by `format:check` like the rest of the
repository. A committed steering file that is not an oxfmt fixed point reds
every gate that runs the test suite: `start-gate`, `review-gate`, and
`fix-precheck` alike.

Two mechanisms keep files there conforming, and neither is new code: a state
declaring both `file:` and `mode:` gets that mode's own
`npx oxfmt --write <%= it.file %>` emitted into its step script ahead of the
commit (`program.ts`'s `steeringModeSteps`), and a state declaring `file:` with
no `mode:` is caught instead by husky → lint-staged running `oxfmt --write` over
staged files during the step commit.

## Comments

Keep a comment — module doc comment or per-export JSDoc alike — only where it
explains an important decision or genuinely unclear code, and keep it as short
as the fact allows. Everything else (restatement of the code, history, a "what"
with no "why") gets deleted, not moved. Machine-read lines are exempt: oxlint
`eslint-disable` pragmas, `shellcheck disable=` directives, and `#!` shebangs
stay, because tooling reads them. No lint rule or comment-density check enforces
this — it isn't a countable property, so human review is the gate.

## Architecture

`CONTEXT.md` is the glossary — the domain language this repo uses (process,
turn, step, capture, rest, gate vs guard, pattern vs edge). Read it before
naming anything, and keep it a glossary: architecture lives here and in the
code, never there.

The two boundaries that are decisions rather than description, and must be
preserved:

- **`src/PatternMachine.ts` is pure.** Definition types, the pattern grammar,
  HEAD resolution, and the step decision. No git, no filesystem, no Effect —
  every export is a plain function of its arguments. Keep it that way. Pure
  means no IO — no git, no filesystem, no Effect; its one import is
  `src/StateFields.ts`, the state-field table, itself a zero-import leaf of
  const data and total functions.
- **Everything IO-shaped lives at the edge.** `src/Edge.ts` (git/templates),
  `src/SteeringMode.ts` (mode commands), `src/StepGuards.ts` (the step-capture
  guard registry), `src/RepoFiles.ts` (the working-tree/committed content port),
  `src/CommandRunner.ts` (the subprocess port). There is no driver-scoped
  git-dir write left at all: `src/Sessions.ts`'s `sessionId`/`resume` are a pure
  derivation of history (`uuidv5` of the resting state's memory key) and write
  nothing — a turn that creates session X but lands no commit re-derives X with
  the same `resume: false` next time, so a driver must treat `resume` as a HINT
  and fall back to the other flag on failure, not a contract; no command —
  `next`, `status`, or `land` — touches the git dir to record that a beat was
  dispatched. Every write gtd causes happens inside a script it emitted and the
  driver ran. A command resolves ONE `Rest` (`Edge.ts`'s `currentRest`/`restAt`)
  and hands it to `planStep`/`planEntry`. Never read a `Rest` after a `perform`.
  `src/program.ts` never reaches into `GitService` directly except two narrow
  exceptions: the `abandon`/`restore` hard/mixed resets — recovery commands that
  must work even when a `Rest` would refuse, so they reset directly instead of
  resolving one — and the review sign-off/feedback-progress gates' own
  `readFileAtRef` reads (they need the COMMITTED, pre-turn copy of a file at
  real `HEAD`, which a `Rest` snapshot — taken before the turn lands — doesn't
  carry). The steering-file gate is deliberately invisible to the pure engine —
  don't "simplify" it back into it.

- **Every git index write tolerates `index.lock` contention.** gtd shares one
  worktree index with the reviewer's editor SCM, `gtd lsp`, and git-aware
  prompts, which all write the index to refresh their stat cache. The
  `index.lock` retry is a property of the `GitOperations` PORT (`src/Git.ts`'s
  `withIndexLockRetries`), applied ONCE above the whole service — both
  `GitService.Live` and the in-memory layer (`src/testing/Layers.ts`'s
  `gitTestLayer`) build their service through it, so a raw `exec` added inside a
  writer can no longer bypass it. Never construct a `GitOperations` and hand it
  straight to `Layer.succeed` — go through `withIndexLockRetries`.

- **`changedPaths` answers by CONTENT, not by the index: a path that EXISTS in
  the working tree is never reported `D`.** Its one caller, `StepGuards.ts`'s
  `requireRevertGuard`, compares the current tree against `reviewBase~1` — an
  index-based answer would call a present-but-untracked path `D` (deleted)
  whenever the index doesn't match the working tree, which would make the guard
  allow every un-reverted tree. `src/Git.ts`'s `classifyUntracked` therefore
  classifies each untracked path against the base tree by blob id: absent → `A`,
  different → `M`, identical → no change. Don't "simplify" it back to the
  index's answer. The worktree side is hashed WITH the repo's clean filters
  (plain `git hash-object -- <paths>`, which looks each file's attributes up
  from its own path) — never `--no-filters`, or a `text=auto` repo reports every
  untouched CRLF file `M`, and a spurious `M` there would flip a clean sign-off
  onto the feedback edge in `deciding`'s classification script and the
  feedback-progress guard. The in-memory double has always compared the base
  tree to the worktree directly, so only the Live tier of
  `runGitServiceContract`'s `changedPaths` base-case group can fail on this.

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
19-operation `GitOperations` contract against BOTH the fake and a real git repo
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
edges, `retry`, `file`/`mode`, `reviewBase`). It compiles through the same
`compileWorkflowConfig` a user's `.gtdrc` `workflow:` key goes through (which
flattens `entry:`/`machines:` via `src/Machines.ts`'s `flattenMachines` before
any per-state compilation), so it never needs its own logic. A state's `mode:`
must name an entry the workflow's own top-level `modes:` map declares (an empty
`{}` entry is enough) — the compiler seeds `qa`/`review` for you, but any OTHER
name (including `prose`) needs its own `modes:` entry, or `validateDefinition`
rejects the state at load time. A state's `file:` names a path RELATIVE to
`.gtd/` — the compiler prepends that directory automatically
(`PatternConfig.ts`'s `stateFile` compiler), so `file: REVIEW.md` compiles to
`.gtd/REVIEW.md`; a `..` segment, an absolute path, or an already-declared
`.gtd/` prefix are all load-time errors. Config-shape errors and
`validateDefinition`'s findings are merged into ONE thrown error, never just the
first — an unrelated state's bad `on` target can't hide behind an earlier
violation. A state's content value starting with `./`/`../` is a file reference,
resolved against the config's directory and auto-inlined at load time; a missing
file is a load error, never silently treated as inline text. After editing,
update:

- **`src/workflows/templates.test.ts`** — the invariants the compiled template
  must keep (one `entry.default`, one review/fix entry, the single `idle` edge
  into `start-gate.check`, the two `questionGate` instances, the
  `design`/`architecture` scope split)
- **e2e feature files** that assert on the bundled template's shape (they set it
  up with the `Given the workflow` step —
  `tests/integration/features/default-workflow.feature`, `driver-doc.feature`,
  `driver-json-status.feature`, `smoke.feature`, `validate.feature`,
  `init.feature`, `initial-state-entry.feature`, `templates-vars.feature`,
  `entry-gate.feature` (the green-baseline gate on every entry),
  `fix-entry.feature` (`--entry fix-precheck`), `entry.feature`
  (`--entry <state>`), `entry-vars.feature`, `prompt-diff-ranges.feature`,
  `land.feature` (the exit-code contract: 0/3/settled/1; `driver-doc.feature`'s
  own `--entry fix-precheck` scenario asserts on the bundled template's shape
  too)
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
all of the above. `src/PatternTemplates.ts` itself never touches git or the
filesystem — every impure value (commit hashes, diff bases, the `read` callback)
is injected by its caller via `TemplateContext`, and a render error (a malformed
template, `read()` throwing) propagates uncaught so a failed render refuses the
step rather than write a broken commit or prompt.

A new STATE PROPERTY is not one of these anymore: it's one entry in
`src/StateFields.ts`'s `STATE_FIELDS` table plus its behaviour (a bespoke
checker or compiler only if the field's rule doesn't fit the table's generic
`nonEmpty`/`commit`/`requires` shape) — declaration, compilation, validation,
the editor JSON schema, and the visualizer's presentation all derive from that
one table and need no separate edit. Read `STATE_FIELDS` for what a state may
declare and how each field behaves, rather than any one derivation site.
`src/Visualize.ts` itself stays git/Effect-free by taking current-state
resolution as a caller-supplied `resolveCurrent` callback rather than resolving
a rest itself — `program.ts`'s `runVisualizeCommand` is the one that supplies
it, backed by `resolveRest`.

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
script; the DRIVER (docs/driver.md's minimal driver, your own, or any loop
harness) executes it verbatim via `bash`. The only place gtd spawns a subprocess
at all is a steering-file mode's own `format:`/`validate:` command.

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
  (`help`/`details`), and `docs/cli.md`'s `## Commands` block is pinned equal to
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
  `attempt: true`) — a fruitless agent dispatch costs money and must be
  remembered across restarts (`Edge.ts`'s `stalledAt`), unlike a fruitless
  check/gate. When adding a state, decide explicitly whether its clean step is a
  signal (declare a `C` row), an attempt (a `prompt` state's default), or a
  no-op (a `script`/`message` state declaring no `C` row)
- A dirty tree matching no declared pattern is a **refusal**, not a no-op —
  distinguish "nothing happened" (clean, no `C` row) from "something happened
  that nothing recognizes" (dirty, no row fires) when writing a new state's `on`
  map
- **Step-capture guards (edge, not engine):** `enforceStepGuards` in
  `src/StepGuards.ts` runs a registry of four guards before a normal commit
  lands — the review-doc, feedback-progress, answer-completeness, and
  require-revert guards each check their own state-flavor condition.
  `enforceStepGuards` samples the committed/working bytes ONCE, then runs every
  applicable guard against that one sample — sound only because a mode's
  `format:` command is normalization-only and must never change what a guard
  decides, regardless of whether it ran before, after, or not at all. A state's
  `file:`+`mode:` formatting and validation is NOT a guard any more:
  `program.ts`'s `steeringModeSteps` emits the mode's own `format:`/`validate:`
  commands (over `src/SteeringMode.ts`) into the step script for the driver to
  run, ahead of the commit. Any guard REFUSES the step when its condition fires,
  so e.g. a malformed steering file is never committed (an agent's draft or a
  human's gate edit alike). Each guard is a no-op when it doesn't apply to the
  resting state (see `StepGuard.appliesTo`), and the whole registry is skipped
  for a no-op decision, or an ATTEMPT (there is nothing to guard in an empty
  diff, and a `format:` run must not dirty an attempt and break the empty-diff
  derivation `stalledAt` relies on). The emitted format/validate pair is skipped
  for an attempt for the same reason, AND for a step whose diff DELETES that
  `file:` (`deletesFile`, shared with the guards): deleting it is a legitimate
  outcome — a review sign-off's whole diff is the review doc's deletion — and a
  `format:` like `prettier --write` exits non-zero on a missing path, which
  aborted the whole `set -euo pipefail` script before the commit and made the
  step unlandable
- **A guard's pre-turn copy of a `file:` is read at real `HEAD`** —
  `enforceStepGuards` never rewinds anything to read it
- The require-revert guard compares the current tree against `reviewBase~1`
  intersected with the human's own review-round commit's touched paths, and it
  exempts gtd's own plumbing by a literal `.gtd/` prefix (`src/StepGuards.ts`'s
  `isCodePath`/`isPlumbingPath`, both over the one shared `STATE_DIR` constant
  in `src/PatternMachine.ts`) — no separate exact-path exemption for the state's
  own `file:` any more, since every `file:` compiles under `.gtd/` too
  (`PatternConfig.ts`'s `stateFile` compiler). Getting the comparison direction
  wrong (matching against `reviewBase` instead of its parent) still makes the
  guard INERT — it allows every un-reverted tree. The two scripts that render
  the exclusion into a pathspec (`src/workflows/unified.yaml`'s `deciding`
  hand-edit test and `re-unwind`'s scoped `git diff`/`git apply -R`) both render
  a bare `:(exclude).gtd` — a LITERAL path test, never a glob, since `.gtd` is a
  fixed string with no metacharacters to escape
