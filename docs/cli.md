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
  format <file>    Format a markdown file in place

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
newline). `--json` emits `{state, actor, kind, content}`:

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
`on` pattern (if any) matches it — no mutation, no template rendering.

```
State: working
Awaits: agent
Pending:
  A DONE.md -> A DONE.md
  A scratch.txt -> (no match)
```

or, on a clean tree: `Pending: (clean)`.

`--json` emits `{state, actor, changes: [{status, path, pattern}]}` — `pattern`
is `null` when no declared row matches that change:

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

## Error envelope

Every command, in `--json` mode, reports a failure inside the JSON object rather
than as unstructured text, and still exits 1:

```json
{ "state": "error", "prompt": "<message>" }
```

## Repository requirements

- **Single writer, linear branch.** A process's history is walked via
  **first-parent** commits only.
- **Test/build artifacts must be gitignored.** This is **load-bearing**, not a
  style preference: every step decision detects "clean" via
  `git status --porcelain`, which silently omits anything matched by
  `.gitignore`. If a `script` state's command (or the build it triggers) writes
  tracked-but-untracked output — a `dist/`, a coverage report, a log file — into
  the working tree, the tree never goes clean after a green run, and the check's
  `"C"` pattern never fires. Gitignore every path your scripts write before
  wiring gtd into a repo.
- **Repository root invocation.** Every subcommand except `--help`/ `--version`
  must run from the git repository root — the workflow, pending changes, and
  process history are resolved against the process cwd.
