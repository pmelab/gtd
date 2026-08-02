# CLI reference

```
Usage: gtd [command] [options]

Commands:
  (no command), loop
                   Launch the loop driver (bin/gtd), which repeatedly drives
                   an agent through gtd next/gtd step calls until the
                   workflow returns to its initial state again. A bare gtd
                   invocation and gtd loop both launch it identically
  init             Scaffold a minimal .gtdrc.json for this repo, seeding the
                   default variables you are most likely to change (the test
                   command) and a Prettier formatting suggestion. gtd runs its
                   built-in workflow by default, so no workflow is written —
                   add a workflow: key only to customize the machine itself.
                   Takes no argument. Run once per repo; refuses if a gtd
                   config already exists. Leaves the file uncommitted for you
                   to review and commit
  step <actor>     Authenticate as <actor>, match the resolved rest's
                   declared patterns against the pending changes, and commit
                   (or squash) the one resulting transition. Pass
                   --cost=<n> (optionally --model=<name>) to record the
                   just-finished invocation's token cost and model on the
                   turn commit (summed into it.processCost/processCostByModel)
  review <commitish>
                   Start a NEW review process at the workflow's declared
                   review-entry state (reviewEntry: true), reviewing
                   <commitish>..HEAD — e.g. a colleague's PR branch. Requires
                   a clean tree resting at the workflow's initial state
  fix              Start a NEW process at the workflow's declared fix-entry
                   state (fixEntry: true) that goes straight into repairing the
                   current failing tests. Requires a clean tree resting at the
                   workflow's initial state
  abandon          End the process currently underway without completing it:
                   close any open review checkout window, then rewind HEAD to
                   the commit the process started from, keeping everything it
                   produced as uncommitted changes. A no-op when no process is
                   underway
  restore          Hard-reset HEAD back to the pre-squash tip retained by the
                   last squash/abandon (refs/worktree/gtd/history), undoing a
                   squash or bringing back an abandoned process's turns.
                   Refuses on a dirty working tree, when there is no retained
                   history, or when HEAD has advanced past the squash with
                   commits that would be lost
  next             Print the resolved rest's rendered script/prompt/message
                   (no mutation)
  edit [path]      Open <path> (repo-relative) in $VISUAL/$EDITOR, blocking
                   until the editor exits. With no argument, opens the
                   resolved rest's declared file (or the repo root if it
                   declares none). Never reads --no-edit/--edit/GTD_NO_EDIT.
                   Low-level plumbing — --edit covers the common "force an
                   edit, then keep driving" case
  status           Print the resolved rest's state/actor and which declared
                   pattern (if any) each pending change matches (no mutation)
  validate         Format and validate the steering file the resolved rest
                   declares, with its mode's commands (its file:/mode:);
                   exits non-zero with the findings when it is invalid
  lsp              Start the LSP server for .gtd/ steering files (stdio)
  visualize        Serve an interactive diagram of the active workflow on a
                   local web server (--port <n>, --no-open; --json prints the
                   model and exits)
  version          Print version and exit
  help             Print this help and exit

Options:
  --json           Output structured JSON instead of plain text
  --port=<n>       (gtd visualize only) port to serve on (default: a free port)
  --no-open        (gtd visualize only) do not open the browser
  --cost=<n>       (gtd step only) record the invocation's token cost
  --model=<name>   (gtd step only, with --cost) tag that cost's model
  --no-edit        (bare gtd or gtd loop only) disable the loop's automatic
                   editor launching at human gates
  --edit, -e       (bare gtd or gtd loop only) force the editor open at the
                   current human gate, overriding --no-edit/GTD_NO_EDIT; a
                   no-op note (not an error) when not at a human gate
  --once           (bare gtd or gtd loop only) run exactly one loop beat (one
                   human gate, one script check+step, or one agent
                   prompt+step), then exit — combines freely with
                   --edit/--no-edit
  --version, -v    Print version and exit
  --help, -h       Print this help and exit
```

`--version` (`-v`) / `gtd version` and `--help` (`-h`) / `gtd help`
short-circuit before any git or repository-state work — they run outside a repo
and in any repo state (the bare subcommands are exact equivalents of their flag
forms). Bare `gtd` (no subcommand) and `gtd loop` both launch the loop driver
(`bin/gtd`) immediately — neither is a usage error. Any other, truly unknown
subcommand remains a usage error: it prints the help text and exits 1 without
touching the repository. Every other (recognized) command must be run from the
**repository root** — gtd derives the workflow, pending changes, and process
history relative to cwd, so it refuses with a clear error if invoked from a
subdirectory.

`--json`, `--cost=<n>`, and `--model=<name>` (the latter two only for
`gtd step`) are the only long options the compiled bundle recognizes. Any other
`--` option (including a typo like `--jsn`) is rejected with a usage error
rather than silently ignored, so a mistyped flag can never degrade a JSON caller
to plain-text mode. A bare `--cost`/`--model` with no value, a non-numeric or
negative `--cost`, an empty `--model`, `--model` without `--cost`, or either
flag on any command other than `gtd step` are all usage errors.

`--no-edit`, `--edit`/`-e`, and `--once` are separate, bash-level flags handled
entirely by `bin/gtd` itself, stripped before anything reaches the bundle — see
below.

## `--no-edit`, `--edit`, `--once`

Three flags on the loop driver only (`--edit` also has the short form `-e`),
each recognized bare (`gtd --no-edit`) or immediately after `loop`
(`gtd loop --no-edit`) — the two positions are equivalent, since bare `gtd` and
`gtd loop` are themselves equivalent. All three combine freely with each other,
in any order (e.g. `gtd --edit --once`, `gtd loop --once --edit`), except
`--edit`/`--no-edit` together, which conflict (forcing and suppressing the
editor in the same run is not a coherent request): naming both, in either
position, is rejected right in `bin/gtd` with a dedicated usage error
(`gtd: --edit and --no-edit are mutually exclusive`, exit 2) — it never reaches
the compiled bundle. Any other placement (e.g. `gtd step --once`) or a
duplicated flag (`gtd --once --once`) is still a usage error, but surfaced via
whatever guard the misplaced argument first reaches (the compiled bundle's own
unknown-option/unknown-command rejection for a misplaced flag, or
`gtd: 'loop' takes no arguments` for one misplaced after `loop`) — never
silently ignored or silently resolved one way.

**`--no-edit`** (or the `GTD_NO_EDIT` environment variable, any non-empty value)
disables the loop's default behavior of launching an editor at human gates,
restoring the halt-and-print-and-exit behavior with no editor involved.

**`--edit`** (`-e`) is `--no-edit`'s mirror: it forces the editor open at the
current human gate, overriding an ambient `GTD_NO_EDIT`/`--no-edit` default for
this one run. It is only meaningful when the machine currently rests at a human
gate — the honesty caveat: at any other rest, forcing an edit is undefined, so
`bin/gtd` prints a note that it isn't at a human gate yet and simply keeps
driving, rather than pretending to force something. Both flags govern only the
loop's own automatic launching — `gtd edit` invoked directly never reads either
(see [`gtd edit`](#gtd-edit-path) above).

**`--once`** restricts the loop to exactly one beat — one human gate, one script
check+step, or one agent prompt+step — then exits, instead of driving all the
way back to idle/settled. Precisely: at most one commit/transition is made;
whichever of the three kinds the currently-resolved rest is, that one gets
processed (including any internal `gtd validate` fix-reprompt rounds a producing
agent turn needs — those are all part of finishing the ONE prompt beat, not
separate beats) and the loop exits 0 immediately after, without re-peeking at
what comes next. A clean human gate with nothing to capture (the opening move's
silent capture attempt under `--no-edit`, or a no-op editor session) is not a
beat and falls through to the driver's ordinary halt, same as without `--once`.

See [Driving the loop](loop.md) and `skills/loop/SKILL.md` for the full
gate-flow description.

## `gtd init`

Scaffolds a **minimal** `.gtdrc.json` at the repository root, plus a `$schema`
link. It writes **no** `workflow:` key — gtd runs the bundled **unified**
workflow as its built-in default, so a state command works out of the box with
no config and no init at all. What `gtd init` seeds is the two things most
projects tune: a `vars: { "testCommand": "npm test" }` entry (the var the
bundled workflow's check script reads) and a ready-to-edit `modes:` block
suggesting a Prettier `format:` for each built-in steering-file mode
(`qa`/`review`). It takes **no argument** — passing one is a usage error
(`gtd init: too many arguments — init takes no argument`).

The bundled default has four entry points — each behind a green-baseline gate
that runs the suite before starting — into one shared review/squash tail (see
[STATES.md §10](../STATES.md#10-the-bundled-workflow-templates)): creating
`.gtd/TODO.md` starts the simple flow (planning → building → checking), creating
`.gtd/REQUIREMENTS.md` starts the advanced flow (two-phase Q&A planning,
per-package parallel build, agentic spec-review), `gtd review <commitish>`
enters review directly, and `gtd fix` goes straight into repairing failing
tests. A red baseline halts at a `*-start-blocked` gate rather than starting new
work. To CUSTOMIZE that machine, add your own `workflow:` key (a full definition
— there is no `extends`/merge); see
[Configuration](configuration.md#the-workflow-key).

The file is written **uncommitted**; review and commit it before your first
`gtd step` (an uncommitted `.gtdrc.json` is a pending change the initial state
would otherwise capture). `gtd init` refuses if the repo root already has its
own gtd config (a global/ancestor config, e.g. `~/.gtdrc`, does not count) and
requires the repository root (or a directory outside any repo). `--json` prints
`{"written":".gtdrc.json","inRepo":true}`. See
[Configuration](configuration.md#gtd-init).

## `gtd step <actor> [--cost=<n>] [--model=<name>]`

Authenticates `<actor>` against the resolved rest and performs the ONE resulting
transition. Unlike v2, there is no fixpoint chain to drive: the pattern
machine's `on` edges are direct one-hop transitions, so a single invocation
authors at most one commit (a normal turn) or performs one squash
(§[STATES.md](../STATES.md#8-the-squash-lifecycle)) — never both, never a chain
of several. A caller that wants several transitions issues several invocations.

`--cost=<n>` records the token cost of the invocation that produced the pending
changes (a non-negative number), and the optional `--model=<name>` tags it with
the model that ran, as a `Gtd-Cost: <n> <model>` trailer on the turn commit —
persisted in the git log, summed across the process into `it.processCost` and
grouped by model into `it.processCostByModel` (see
[Configuration: Token cost](configuration.md#token-cost)). `--model` requires
`--cost`. On a squash they are folded into the process total/breakdown the
`commit:` template renders rather than written as a trailer. Both are orthogonal
to `--json`.

- **Out-of-turn refusal** — `<actor>` isn't the resolved state's declared actor:
  exit non-zero, zero commits.
  `gtd step <actor>: out of turn — "<state>" awaits <awaited-actor>`
- **No-match refusal** — the tree is dirty and no declared `on` pattern matches:
  exit non-zero, zero commits, naming every declared pattern.
  `gtd step <actor>: no declared pattern matches the pending changes at "<state>" — declared patterns: <p1>, <p2>, …`
- **No-op** — the tree is clean and the state declares no `C` pattern: exit
  **0**, zero commits. This is the default, silent case a loop driver relies on
  (see [Driving the loop](loop.md)).
- **Commit/squash** — a pattern matched: exit 0, one commit (or one squash)
  authored.

Plain-mode output is one line:

```
committed: gtd(human): idle → planning
```

or, at a no-op:

```
nothing to do at "idle"
```

`--json` emits `{state, subject}` — `subject` is `null` at a no-op — plus
`cost`/`model` keys echoing what `--cost`/`--model` recorded (each omitted when
not passed):

```json
{
  "state": "idle",
  "subject": "gtd(human): idle → planning",
  "cost": 1450,
  "model": "claude-opus-4-8"
}
```

## `gtd review <commitish> [--json]`

Starts a BRAND NEW review process at the active workflow's declared
`reviewEntry: true` state (see
[STATES.md §11](../STATES.md#11-the-review-checkout-window)), reviewing
`<commitish>..HEAD` — e.g. a colleague's PR branch pushed on top of a shared
base, with no gtd process of its own. Reuses the workflow's existing
review/feedback machinery unmodified; there is no separate review-entry command
surface to keep in sync.

Requires, in order (any failure is a plain refusal — exit non-zero, nothing
written):

- the machine currently resting at the workflow's **initial state** (a plain
  non-gtd branch resolves there via the inert-subject rule — the normal case; a
  process already underway refuses — finish it, or
  [`gtd abandon`](#gtd-abandon---json) it);
- a **clean working tree**;
- the active workflow declaring a **`reviewEntry: true`** state (otherwise:
  `gtd review: the active workflow declares no review entry state`);
- `<commitish>` resolving to a commit, being an **ancestor of HEAD**, and
  **differing from HEAD** (nothing to review otherwise).

On success, writes ONE empty commit, `gtd(human): <review-entry-state>`,
carrying the resolved commit's full hash as a `Gtd-Review-Base: <hash>` trailer
(mirroring how `gtd step --cost` writes its own `Gtd-Cost:` trailer). Everything
downstream that renders a diff — `it.processDiff`, and the review checkout
window opened by a downstream `reviewWindow: true` state — keys off the
process's diff base, and this trailer is exactly how that base gets re-pointed
at `<commitish>..HEAD` (see
[STATES.md §7](../STATES.md#7-retry)/[§11](../STATES.md#11-the-review-checkout-window)).

Plain-mode output is one line, same shape as `gtd step`:

```
committed: gtd(human): review-start-check
```

`--json` emits `{state, subject}` — `state` is the entered review-entry state,
`subject` the bare commit subject (the trailer is not echoed).

Takes exactly one positional argument (`<commitish>`); missing or extra
arguments are usage errors.

In the bundled unified template the review-entry state is `review-start-check` —
a green-baseline gate that runs the suite and, once green, transitions to
`reviewing`; a red run halts at `review-start-blocked` (see
[STATES.md §10](../STATES.md#10-the-bundled-workflow-template)).

## `gtd fix [--json]`

Starts a BRAND NEW process at the active workflow's declared `fixEntry: true`
state (see [STATES.md §10](../STATES.md#10-the-bundled-workflow-template)) that
goes straight into repairing the current failing tests. It is the standalone
counterpart to the entry gates: the gates refuse to start new work on a red
baseline, and `gtd fix` is the dedicated way to get back to green — repair,
review, and squash a broken baseline into one commit.

Requires, in order (any failure is a plain refusal — exit non-zero, nothing
written):

- the machine currently resting at the workflow's **initial state** (a process
  already underway refuses — finish it, or [`gtd abandon`](#gtd-abandon---json)
  it);
- a **clean working tree**;
- the active workflow declaring a **`fixEntry: true`** state (otherwise:
  `gtd fix: the active workflow declares no fix entry state`).

Takes no positional argument (extra arguments are a usage error). Unlike
`gtd review`, it writes NO `Gtd-Review-Base:` trailer — a fix reviews its own
fixes from the ordinary process start — so on success it writes just one empty
commit, `gtd(human): <fix-entry-state>`:

```
committed: gtd(human): fix-check
```

`--json` emits `{state, subject}`, same shape as `gtd review`. In the bundled
unified template the fix-entry state is `fix-check`: a red suite drops into the
shared `fixing` loop and out through the review + squash tail; a green suite is
a no-op back to `idle`.

## `gtd abandon [--json]`

Ends the process currently underway **without completing it** — the way out of a
process nobody is going to finish, and the command `gtd review`/`gtd fix` name
when they refuse ("finish it, or run `gtd abandon`, before starting a review").
A workflow's own exit is its squash finale
([STATES.md §8](../STATES.md#8-the-squash-lifecycle)); this is the human's, and
it targets the same boundary:

1. any open **review checkout window** is closed first (the bracket every state
   subcommand runs — see
   [STATES.md §11](../STATES.md#11-the-review-checkout-window)), so the rewind
   starts from the real head, not the rewound base;
2. HEAD is `git reset --mixed`ed to the commit the process started from (its
   start parent — the same target a squash resets to).

**Nothing is discarded.** Every turn commit the process wrote is dropped, and
everything they carried — the code, the `.gtd/` steering files — stays in the
working tree as uncommitted changes for you to keep, re-commit, or throw away
with ordinary git:

```
abandoned the process resting at "await-review" — HEAD is back at 1a2b3c4
("feat: add calculator"), resting at "idle".
Everything the process produced is kept as uncommitted changes (`git status`);
discard them with `git checkout -- . && git clean -fd .gtd` for a clean tree.
```

Takes no positional argument (extra arguments are a usage error). Resting at the
workflow's initial state is a **no-op success**, not a refusal — a recovery
command that fails when there is nothing to recover is a worse tool:

```
no gtd process is underway (resting at "idle") — nothing to abandon
```

The one refusal is a process whose first commit is the repository's own root
commit: there is no earlier commit to rewind to, so its commits have to be
removed by hand.

`--json` emits `{state, abandoned, from, head}` — `state` is the initial state
the machine returns to, `abandoned` whether anything was rewound, and (only when
it was) `from` the state the abandoned process rested at plus `head` the full
hash HEAD now points at:

```json
{
  "state": "idle",
  "abandoned": true,
  "from": "await-review",
  "head": "1a2b3c4…"
}
```

The no-op reports `{"state": "idle", "abandoned": false}` and still exits 0.

## `gtd restore [--json]`

Undoes the last squash or `gtd abandon` by hard-resetting HEAD back to the
pre-squash tip that either one retains, before acting, on the per-worktree
`refs/worktree/gtd/history` ref
([STATES.md §8](../STATES.md#8-the-squash-lifecycle)):

```
restored the retained history — HEAD is back at 1a2b3c4 ("gtd(agent): drafting
→ working"), resting at "await-review". Resume with the loop, or `git reset`
to any earlier turn to restart from there.
```

Refuses on a dirty working tree — commit, stash, or discard your changes first.
Refuses when there is no retained history to restore (nothing has been squashed
or abandoned yet, or a previous `restore` already consumed it). Refuses when
HEAD has advanced past the retained tip with commits that would be discarded by
resetting:

```
gtd restore: HEAD has advanced past the squash — restoring would discard
commits built on top of it — HEAD 4d5e6f7 is ahead of the retained tip
1a2b3c4.
```

Takes no positional argument (extra arguments are a usage error).

`--json` emits `{state, restored, to, from}` — `state` is the resolved rest
after the reset, `restored` always `true` (a refusal exits non-zero instead),
`to` the full hash HEAD was reset to, and `from` the state the machine rested at
before the reset:

```json
{
  "state": "await-review",
  "restored": true,
  "to": "1a2b3c4…",
  "from": "idle"
}
```

## `gtd next [--json]`

Pure emitter of the resolved rest's rendered content — it **never mutates** the
repository (no commits, no file writes, no script execution). Resolves HEAD
exactly like `gtd step`, renders that state's declared
`script`/`prompt`/`message` template, and prints it. `kind` is never `"commit"`
here: resolution never rests at a commit state (entering one always ends the
process in the same step that entered it — see
[STATES.md §5](../STATES.md#5-resolution)).

Plain mode prints the rendered content verbatim (with exactly one trailing
newline) — never the `model`/`memory`/`file`/`mode`/`edges` structured keys,
which are JSON-only. `--json` emits
`{state, actor, kind, content, model?, memory?, file?, mode?, edges?}`:

```json
{
  "state": "building",
  "actor": "agent",
  "kind": "prompt",
  "content": "You are an autonomous coding agent. ..."
}
```

- `state` — the resolved state.
- `actor` — the state's declared actor.
- `kind` — `"script"` | `"prompt"` | `"message"` — the dispatch key a driver
  switches on (see [Driving the loop](loop.md)).
- `content` — the fully rendered template.
- `model` — the state's opaque `model:` hint, RENDERED through the same template
  context as `content` (see
  [Configuration](configuration.md#model--the-opaque-harness-hint-template-rendered)),
  present only when the state declares one; **omitted entirely** (never `null`)
  when unset.
- `memory` — the state's opaque `memory:` scope label, RENDERED the same way
  (see
  [Configuration](configuration.md#memory--the-memory-scope-label-template-rendered)).
  A memory-aware driver retains an agent's memory across consecutive agent turns
  sharing this label and starts fresh when it changes. Present only when the
  state declares one; **omitted entirely** (never `null`) when unset.
- `file` — the state's declared steering file, RENDERED the same way; `mode` —
  its format's name, verbatim (a built-in `"qa"`/`"review"`, or a
  workflow-declared mode) (see
  [Configuration](configuration.md#filemode--the-steering-file-association)).
  Both present only when the state declares them; **omitted entirely** (never
  `null`) otherwise.
- `edges` — the resting state's `on` edges as `[{ pattern, target, describe? }]`
  (declaration order) — the same list the content template sees as `it.edges`
  (see
  [Configuration](configuration.md#on-values--a-target-or-a--to-describe--route-description)).
  A driver relaying a human gate's message has the routing (and each edge's
  human-readable `describe`) alongside the rendered text. **Omitted entirely**
  when the state has no `on` (a commit state); a per-edge `describe` is likewise
  omitted when that edge declares none.

## `gtd edit [path]`

Low-level plumbing: for the common case of "force an edit at the current human
gate, then keep driving the loop", use `--edit` (below) instead. `gtd edit`
itself only opens an editor on a path — it never drives anything afterward,
which makes it the right tool for opening a SPECIFIC path (or peeking at the
current rest's file) without starting a loop.

Handled entirely in `bin/gtd`'s own bash — unlike every other subcommand, it is
**never forwarded** to the compiled bundle (`dist/gtd.bundle.mjs`).

With `<path>` given (repo-relative), opens it in `${VISUAL:-$EDITOR}` (git's own
precedence — `$VISUAL` first, then `$EDITOR`; no fallback to `vi`), blocking in
the foreground until the editor exits. It creates nothing if `<path>` doesn't
exist — the path is handed straight to the editor command verbatim. The editor's
own exit code is ignored entirely; success is judged from tree state afterward,
not from this command.

With no argument, it peeks with `gtd next --json` to find the resolved rest's
declared `.file`, and opens that (repo-relative), or the repo directory (`.`)
when the resolved state declares no `file:`. If `gtd next --json` itself fails
(e.g. not in a repo), it prints an error and exits non-zero without attempting
to open an editor:

```
gtd edit: could not determine the next step:
<gtd next --json's own error output>
```

`gtd edit` **never** reads `--no-edit`/`--edit`/`GTD_NO_EDIT` — those govern
only the loop's own automatic editor launching at human gates (see
[Driving the loop](loop.md) and `skills/loop/SKILL.md`), not this command.
Invoked directly, `gtd edit` always launches, unconditionally.

If neither `$VISUAL` nor `$EDITOR` is set, no editor is launched:

```
gtd: no editor configured — set $EDITOR (or $VISUAL)
```

## Running `script` rests (no `gtd` subcommand)

There is no `gtd` subcommand that executes a workflow script — gtd never runs a
workflow script itself. When `gtd next` resolves to a `script`-content rest, the
**driver** (`bin/gtd`, or any loop harness) executes the emitted `content`
verbatim via `bash -c` — foreground, inherited stdio, exit code deliberately
ignored (a check script encodes its outcome in the tree, e.g. writing a findings
file, never in its exit status) — then runs `gtd step <actor>` for that state's
own actor to capture the outcome. See [Driving the loop](loop.md).

## `gtd status [--json]`

Pure, read-only dry-run reporter — the same resolution `gtd next` performs, but
reporting the resolved state/actor and, for every pending change, which declared
`on` pattern (if any) matches it — no mutation, and no CONTENT rendering (the
`script`/`prompt`/`message`/`commit` template is never rendered here, unlike
`gtd next`). It DOES render the resolved state's `model:`/`memory:`/`file:`
hints (if declared) through the same `it.vars`-carrying template context
`gtd next` uses — see
[Configuration](configuration.md#model--the-opaque-harness-hint-template-rendered)
— so a templated `model:`/`memory:`/`file:` failing to render fails `gtd status`
too, exactly like it would fail `gtd next`.

```
State: working
Awaits: agent
Pending:
  A DONE.md -> A DONE.md
  A scratch.txt -> (no match)
```

or, on a clean tree: `Pending: (clean)`. A `Model: <value>` line appears right
after `Awaits:` when the resolved state declares a `model:` hint, and
`Memory: <value>`/`File: <value>`/`Mode: <value>` lines appear after that (in
that order) when declared — each independently, only when set. A `Cost: <n>`
line appears after those when the current process has accumulated any
`Gtd-Cost:` (see [`gtd step --cost`](#gtd-step-actor---costn-model-name)),
omitted when the running total is `0`; when the breakdown adds information (more
than one model, or a single tagged model), indented `  <model>: <cost>` lines
follow it.

`--json` emits
`{state, actor, changes: [{status, path, pattern}], model?, memory?, file?, mode?, cost?, costByModel?, edges?}`
— `pattern` is `null` when no declared row matches that change;
`model`/`memory`/`file`/`mode` are present only when the resolved state declares
them; `cost`/`costByModel` (the `[{model, cost}]` breakdown) only when the
running process total is above `0`; and `edges` is the resting state's `on`
edges as `[{ pattern, target, describe? }]` (same as `gtd next --json`), omitted
when the state has no `on` (all omitted entirely, never `null`, otherwise):

```json
{
  "state": "working",
  "actor": "agent",
  "changes": [
    { "status": "A", "path": "DONE.md", "pattern": "A DONE.md" },
    { "status": "A", "path": "scratch.txt", "pattern": null }
  ]
}
```

`gtd status` takes no arguments — extra positional args are rejected.

## `gtd validate [--json]`

Format **and** validate the steering file the resolved rest declares. It
resolves the current state exactly like `gtd status`, renders that state's
`file:`, formats that file in place, then validates it — both per its `mode:`:

- **formatting** happens only if the mode declares a `format:` shell command
  (see [Configuration](configuration.md#modes--pluggable-steering-file-modes)) —
  gtd ships no formatter, so nothing is rewritten until a project plugs one in;
- **validation** runs the mode's `validate:` command when it declares one (its
  output becomes the findings), and otherwise, for the built-in `qa`/`review`
  names, gtd's own pure parser (`src/OpenQuestions.ts` / `src/ReviewDoc.ts` —
  the same parsers the LSP publishes as diagnostics, so there is one source of
  truth per format).

Then:

- A well-formed file exits `0` (`<file>: valid`, or `{"valid":true, ...}` with
  `--json`) — and is left formatted, if the mode formats at all.
- Violations exit **non-zero** with the findings, one per line — the signal a
  producing agent, or the driving loop, loops on until the file is well-formed.
- A state that declares no `file:`/`mode:`, or whose file is **absent** (e.g.
  `building` deleted `.gtd/TODO.md`, or a human deleted `.gtd/REVIEW.md` to
  approve), has nothing to validate and exits `0`
  (`nothing to validate at "<state>"`). Nothing is formatted in that case.

This is how the unified template keeps its steering files well-formed without an
in-machine validation state — and the check runs whoever last touched the file,
agent or human:

- **The producing agent self-validates.** Plain `gtd next` appends a "run
  `gtd validate` and fix all violations" instruction to a `prompt` rest that
  declares `file:`+`mode:`; `gtd next --json` withholds it and the driving loop
  runs `gtd validate` after the turn instead (see `bin/gtd` /
  [STATES.md §12](../STATES.md#12-steering-file-validation-gtd-validate)).
- **`gtd step` enforces the same gate.** Capturing a turn out of a state that
  declares `file:`+`mode:` formats that file in place and validates it first
  (with the very same mode commands), and **refuses the step** (committing
  nothing) when it is invalid — so a human's edit at a gate (answering at
  `adv-grilling-answer`, reviewing at `await-review`) is formatted and checked
  exactly like an agent's draft, and a malformed steering file is never
  committed.

`gtd validate` takes no arguments.

## `gtd lsp`

Starts an LSP server over stdio for `.gtd/` steering files — document symbols
for a `qa`-mode file's open questions and, for a `review`-mode file, one symbol
per chunk that still has an unchecked hunk (the outline lists only the packages
left to review, with no hunk children), code actions to check/uncheck a hunk or
a whole chunk, go-to-definition (`textDocument/definition`) from a `review`-mode
hunk pointer line into the file it points at (at its 1-based `#line`, or the top
of the file for a bare `./path`; the `./`-relative path resolves against the
repo's git toplevel), and diagnostics publishing the same parser findings
`gtd validate` reports (see `src/OpenQuestions.ts` / `src/ReviewDoc.ts` and
[STATES.md §12](../STATES.md#12-steering-file-validation-gtd-validate)).

**Config-driven** (see
[docs/design/state-file-association.md](design/state-file-association.md)): the
server locates the active gtd config the same way the CLI does, from the
`initialize` request's workspace root (falling back to the open document's own
directory), renders every state's `file:` into an absolute-path → `mode` map,
and dispatches on it — first declaring state wins a path conflict. A path the
map doesn't cover (or no config at all) falls back to the basename dispatch
(`TODO.md` → `qa`, `REVIEW.md` → `review`), so the server still works standalone
with no `.gtdrc` in sight. Also registers an `executeCommand`,
`gtd.openSteeringFile`: resolves the current state exactly like `gtd status`
(config + git HEAD) and asks the client to show its `file:`
(`window/showDocument`); a state with no `file:` gets an informational message
naming the state instead — bind it to an editor keybinding for a "jump to the
active steering file" command.

Dispatched before the repository-root guard and the config-reading path — the
server needs no git/workflow state of its own (like `gtd init`, it needs no
config to run). Rejects `--json` (exit 1, `gtd lsp does not accept --json`) and
extra positional arguments — it's a long-running server, not a state command.
Runs until the client disconnects (the LSP `exit` notification), then exits
cleanly.

## `gtd visualize [--port=<n>] [--no-open] [--json]`

Serve an interactive diagram of the ACTIVE workflow on a local web server: the
main flow as a graph (each sub-machine invocation collapsed into a single opaque
black-box node — click it to jump to that sub-machine's own diagram, rendered
separately below with its true member states/shapes/colours and a muted ghost
node for any edge leaving the group; every diagram supports scroll-to-zoom,
drag-to-pan, and a corner `+`/`−`/fit control cluster), a click-through
inspector with each state's actor, content kind, its own raw
prompt/message/script text, model/memory, steering file+mode, retry, flags, and
outgoing/incoming edges, and — read ONCE at page load, never polled — a "Current
state" panel showing where the active process rests, its pending changes, and
which `on` pattern (or retry redirect) currently leads where, with the resting
node highlighted in the diagrams. This is the replacement for the removed
`gtd mermaid` — a live viewer instead of a static diagram dump.

```
$ gtd visualize
gtd visualize running at http://127.0.0.1:53017 — Ctrl-C to stop
```

The server serves three routes: `/` (the self-contained HTML page),
`/workflow.json` (the model the page renders), and `/state.json` (the current
process's resting state, or `{}` when there isn't one — not a repo, no commits,
or an older server; the browser tolerates either). It runs until interrupted
(Ctrl-C), then closes cleanly. Options (orthogonal, `gtd visualize` only):

- `--port=<n>` (or `--port <n>`) — serve on a specific port (0–65535); the
  default is a free ephemeral port, printed on start.
- `--no-open` — do not open the default browser (the URL is always printed).
- `--json` — print the workflow model to stdout and exit WITHOUT starting a
  server (unchanged shape — live state is a server-only concern). The model is
  `{ states, initial, groups, vars }`; each state carries its
  `actor`/`kind`/`content`/`model`/`memory`/`file`/`mode`/`retry`/`flags`
  (`content` is the state's own raw script/prompt/message text, omitted for a
  commit state), its `on` edges, its computed `incoming` edges, and its
  sub-machine `group`. `groups` lists each sub-machine invocation and the
  concrete states it produced.

Dispatched before the repository-root guard and the config-reading path's review
window — it reads the active workflow (the built-in default when none is
configured) but touches no git/HEAD/review-window state ITSELF; the
`/state.json` route best-effort reads git state per request instead (any failure
— not a repo, no commits — serves `{}`), preferring the review checkout window's
saved head over HEAD so a request landing mid-window still reports the state the
process actually rests at. The diagram is rendered with Mermaid loaded from a
CDN, so the graph needs network access the first time a browser loads the page;
the inspector and current-state panel work offline regardless. Rejects unknown
options and unexpected positional arguments.

## Error envelope

Every command, in `--json` mode, reports a failure as a machine-readable
envelope on **stdout**, and still exits 1:

```json
{ "state": "error", "prompt": "<message>" }
```

A human-readable `gtd: <message>` line is still written to **stderr** regardless
of `--json` — the envelope adds a structured stdout channel, it does not replace
the plain-text one.

## Repository requirements

- **Single writer, linear branch.** A process's history is walked via
  **first-parent** commits only.
- **Test/build artifacts must be gitignored.** This is **load-bearing**, not a
  style preference: every step decision detects "clean" via
  `git diff --name-status HEAD` (tracked changes) unioned with
  `git ls-files --others --exclude-standard` (untracked files), which silently
  omits anything matched by `.gitignore`. If a `script` state's command (or the
  build it triggers) writes tracked-but-untracked output — a `dist/`, a coverage
  report, a log file — into the working tree, the tree never goes clean after a
  green run, and the check's `"C"` pattern never fires. Gitignore every path
  your scripts write before wiring gtd into a repo.
- **Repository root invocation.** Every state subcommand (`step`/`review`/
  `next`/`status`) must run from the git repository root — the workflow, pending
  changes, and process history are resolved against the process cwd.
  `--help`/`--version` (and the `help`/`version` subcommands), `lsp`, and
  `visualize` skip this guard entirely (`visualize` still reads the `.gtdrc`
  workflow, but needs no git state).
- **Linked worktrees are independent.** N `git worktree` worktrees of one
  repository (sharing a single `.git`) each run their own gtd process: state is
  derived from that worktree's own HEAD, and the review checkout window's refs
  live in git's per-worktree `refs/worktree/gtd/*` namespace, so a review
  resting in one worktree neither blocks nor rewrites any other
  ([STATES.md §11](../STATES.md#11-the-review-checkout-window)). This holds from
  7.2 on; gtd ≤ 7.1 kept the window under the shared `refs/gtd/*` refs, where
  the first worktree to open one clobbered every sibling's branch.
