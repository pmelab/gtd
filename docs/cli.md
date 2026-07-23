# CLI reference

```
Usage: gtd [command] [options]

Commands:
  step <actor>     Authenticate as <actor>, match the resolved rest's
                   declared patterns against the pending changes, and commit
                   (or squash) the one resulting transition
  next             Print the resolved rest's rendered script/prompt/message
                   (no mutation)
  run              Execute the resolved rest's emitted script, then step its
                   actor (the built-in script driver)
  status           Print the resolved rest's state/actor and which declared
                   pattern (if any) each pending change matches (no mutation)
  mermaid          Print the active workflow's shape as Mermaid
                   stateDiagram-v2 source (no mutation)
  format <file>    Format a markdown file in place
  lsp              Start the LSP server for .gtd/ steering files (stdio)

Options:
  --json           Output structured JSON instead of plain text
  --version, -v    Print version and exit
  --help, -h       Print this help and exit
```

`--version` (`-v`) and `--help` (`-h`) short-circuit before any git or
repository-state work — they run outside a repo and in any repo state. Bare
`gtd` (no subcommand) is a usage error: it prints the help text and exits 1
without touching the repository. Every other command must be run from the
**repository root** — gtd derives the workflow, pending changes, and process
history relative to cwd, so it refuses with a clear error if invoked from a
subdirectory.

`--json` is the only long option. Any other `--` option (including a typo like
`--jsn`) is rejected with a usage error rather than silently ignored, so a
mistyped flag can never degrade a JSON caller to plain-text mode.

## `gtd step <actor>`

Authenticates `<actor>` against the resolved rest and performs the ONE resulting
transition. Unlike v2, there is no fixpoint chain to drive: the pattern
machine's `on` edges are direct one-hop transitions, so a single invocation
authors at most one commit (a normal turn) or performs one squash
(§[STATES.md](../STATES.md#8-the-squash-lifecycle)) — never both, never a chain
of several. A caller that wants several transitions issues several invocations.

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
committed: gtd(human): grilling
```

or, at a no-op:

```
nothing to do at "idle"
```

`--json` emits `{state, subject}` — `subject` is `null` at a no-op:

```json
{ "state": "grilling", "subject": "gtd(human): grilling" }
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
  its format, verbatim (`"qa"` | `"review"`) (see
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

## `gtd run`

The built-in driver for a `script`-content rest — the **only** place gtd itself
spawns a subprocess. Renders the resolved rest exactly like `gtd next`, executes
its content verbatim via `bash -c` (foreground, inherited stdio, exit code
deliberately ignored — a check script encodes its outcome in the tree, e.g.
writing a findings file, never in its exit status), then runs `gtd step <actor>`
for that state's own actor to capture the outcome in one command. Refuses (exit
non-zero, no execution, no step) when the resolved rest isn't a script:

```
gtd run: "<state>" awaits a <kind> from "<actor>" — nothing scripted to run
```

Reports the same `{state, subject}` (or `committed: …` / `nothing to do at "…"`)
as `gtd step` for the capturing step it performs. Takes no arguments — extra
positional args are rejected.

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
that order) when declared — each independently, only when set.

`--json` emits
`{state, actor, changes: [{status, path, pattern}], model?, memory?, file?, mode?, edges?}`
— `pattern` is `null` when no declared row matches that change;
`model`/`memory`/`file`/`mode` are present only when the resolved state declares
them (omitted entirely, never `null`, otherwise); `edges` is the resting state's
`on` edges as `[{ pattern, target, describe? }]` (same as `gtd next --json`),
omitted when the state has no `on`:

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

## `gtd mermaid`

Pure emitter of the active workflow's **shape** — not the resolved rest — as
Mermaid [`stateDiagram-v2`](https://mermaid.js.org/syntax/stateDiagram.html)
source (see `src/Mermaid.ts`): one node per declared state, the `[*] -->`
initial-state marker, one edge per declared `on` row labeled with its raw
pattern string (same declaration order the engine itself evaluates), a `--> [*]`
edge for every commit state (final, no outgoing edges — see
[STATES.md §8](../STATES.md#8-the-squash-lifecycle)), and one `note right of`
per rest naming its actor, content kind, and retry cap (e.g.
`agent · prompt · retry 3→escalate`). No git, no HEAD resolution, no template
rendering — purely a function of the compiled `WorkflowDefinition`, so its
output is identical regardless of the current process/branch state.

```
$ gtd mermaid
stateDiagram-v2
    state "idle" as idle
    state "grilling" as grilling
    ...
    [*] --> idle
    idle --> grilling : * **
    ...
    note right of idle : human · message
    ...
```

Pipe it straight into a `.md`/`.mmd` file, a GitHub issue/PR description, or any
Mermaid-aware renderer (GitHub, GitLab, VS Code, Obsidian, the
[Mermaid Live Editor](https://mermaid.live)) to get a diagram of a custom
`.gtdrc` `workflow:` with no hand-maintained docs required.

State names are aliased to Mermaid-safe identifiers (non-word characters fold to
`_`; a digit-led name gets an `s_` prefix) via a `state "<name>" as <alias>`
declaration up front, so a hyphenated name like `todo-validating` still displays
with its exact declared spelling. Rejects `--json` (exit 1,
`gtd mermaid does not accept --json`) — there is no structured shape to emit
beyond the Mermaid source itself — and takes no arguments (extra positional args
are rejected).

## `gtd format <file>`

Formats a markdown file in place with a bundled prettier (`parser: "markdown"`,
`printWidth: 80`, `proseWrap: "always"`), ignoring the host repo's own
`.prettierrc` so `.gtd/`-tracked files stay consistently formatted regardless of
the host project's toolchain. Rejects `--json` (exit 1,
`gtd format does not accept --json`) — it's a plain file operation, not a state
command.

Errors (all exit 1, message on stderr):

- Missing path: `gtd format: missing file path argument`
- Extra arguments: `gtd format: too many arguments — expected one path, got: …`
- Non-markdown file:
  `gtd format: <file> is not a markdown file (expected .md or .markdown)`
- File not found: `gtd: skipped formatting <file>: not found`

## `gtd lsp`

Starts an LSP server over stdio for `.gtd/` steering files — document symbols
for a `qa`-mode file's open questions and a `review`-mode file's review
chunks/hunks, code actions to check/uncheck a hunk or a whole chunk, and
diagnostics publishing the same parser findings the bundled workflow's
`.gtd/FORMAT.md` validators produce (see `src/OpenQuestions.ts` /
`src/ReviewDoc.ts` and
[STATES.md §10](../STATES.md#10-the-bundled-default-workflow)).

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

Dispatched before the repository-root guard and auto-init, like `gtd format`.
Rejects `--json` (exit 1, `gtd lsp does not accept --json`) and extra positional
arguments — it's a long-running server, not a state command. Runs until the
client disconnects (the LSP `exit` notification), then exits cleanly.

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
- **Repository root invocation.** Every state subcommand (`step`/`next`/`run`/
  `status`/`mermaid`) must run from the git repository root — the workflow,
  pending changes, and process history are resolved against the process cwd.
  `--help`/`--version`, `format`, and `lsp` skip this guard entirely (and any
  git/`.gtdrc` dependency along with it).
