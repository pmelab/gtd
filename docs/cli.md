# CLI reference

## Commands

```
Usage: gtd [command] [options]

Commands:
  init             Scaffold a minimal .gtdrc.json for this repo, seeding the
                   default variables you are most likely to change (the test
                   command) and a Prettier formatting suggestion. gtd runs its
                   built-in workflow by default, so no workflow is written —
                   write a gtd.config.ts only to customize the workflow itself.
                   Takes no argument. Run once per repo; refuses if a gtd
                   config already exists. Leaves the file uncommitted for you
                   to review and commit
  land             Land whatever the tree now shows at the currently resolved
                   rest — a human capture, an agent/check turn, or an empty
                   attempt (a fruitless prompt turn). Pass
                   --cost=<n> (optionally --model=<name>) to record the
                   just-finished invocation's token cost and model on the
                   turn commit (summed into it.processCost/
                   processCostByModel). Plain (the default) prints one
                   human-readable sentence naming the commit subject (or a
                   no-op note) plus a pointer to `gtd land --json=script | sh`
                   to get the landing script — never the script itself.
                   --json emits script (the actual POSIX sh
                   a driver runs) alongside settled, idle, state (the
                   post-land target), subject, cost and model. Exits 0 on
                   success, 1 on any refusal — see the Exit codes section
                   below
  (no command) --entry <state>
                   Starts a new process authenticated as human, e.g.
                   'gtd --entry <state>'
  abandon          End the process currently underway without completing it:
                   rewind HEAD to the commit the process started from,
                   keeping everything it produced as uncommitted changes. A
                   no-op when no process is underway
  restore          Hard-reset HEAD back to the tip retained by the last
                   abandon (refs/worktree/gtd/history), bringing back an
                   abandoned process's turns. Refuses on a dirty working
                   tree, when there is no retained history, or when HEAD has
                   advanced past the retained tip with commits that would be
                   lost
  next             Print the resolved rest's beat (no mutation, safe to
                   poll), in one of three encodings. Plain (the default): a
                   status summary, a blank line, then the step verbatim — at a
                   script/capture rest an instruction line ('Run this
                   script:' / 'The edit is already made — run `gtd land` to
                   land it.') precedes the status summary; at a prompt rest
                   it's the bare step (plus the self-validation instruction
                   when applicable) with no header at all, since those bytes
                   are the agent's own input. --json emits the one structured
                   surface gtd has: kind (capture|message|script|prompt|
                   stalled) selects what a driver does, content is what it
                   runs or shows, idle marks the workflow's initial state with
                   a clean tree, plus the prompt session, model, validate
                   script, log path, changes, next and the resting state's own
                   fields. --json=<path> (a dotted key path into that same
                   document, e.g. kind, content, session.id) prints just that
                   value instead of the whole document — see --json's own help
                   above. Exits 0 — see the Exit codes section below
  validate         Print the script that formats (when declared) then
                   validates the resolved rest's steering file, using its
                   mode's commands (its file:/mode:), instead of running it —
                   a driver runs the script and reads the findings from its
                   own exit code/output. Always exits 0; prints "nothing to
                   validate" when the resolved rest declares nothing to run.
                   On a non-zero validate exit the emitted script prints a
                   ready-to-send fix prompt (instruction + findings) and
                   exits with the validator's own code
  lsp              Start the LSP server for .gtd/ steering files (stdio)
  visualize        Serve an interactive diagram of the active workflow on a
                   local web server (--port <n>, --no-open). Prints the
                   chosen port on its own line — with --port 0, this is the
                   only way to learn which port was picked
  ui               Expose gtd's web/phone client for THIS worktree — the
                   invoking directory, never a configured list of roots — and
                   refuses outside a repository like every other state command.
                   By default, publishes through `tailscale serve` (reachable
                   from anywhere on the tailnet, including over a DERP relay)
                   with tailscaled terminating TLS, walking 8443, then 10000,
                   then 443 until one publishes; falls back to binding a local
                   HTTPS server directly, never refusing, when none of the
                   three works. --host <addr> opts out of serve and binds that
                   address directly instead; --port <n> overrides the serve
                   port (default: the first free of 8443, 10000, 443), or the
                   bind port when --host is given (default: a free port);
                   --self-signed also opts out of serve, generating a
                   throwaway TLS certificate instead of the configured
                   ui.cert/ui.key; --dev runs against local development sources
                   instead of the packaged build
  check <mode> <file>
                   Read <file> and run the built-in steering format named
                   <mode> (see `gtd validate`'s modes: qa, review) over its
                   contents, printing each finding one per line and exiting
                   non-zero when there are any. Resolves no workflow state and
                   reads no config — standalone, runnable from any directory
                   with <mode>/<file> given explicitly. This is what a
                   workflow's emitted validation script invokes as a leaf step.
                   --open-questions runs the qa unanswered-questions predicate
                   instead (see --help)
  uncheck <file>   Read <file> and reset every review-mode `- [x]`/`- [X]`
                   file-pointer box back to `- [ ]`, writing the result back
                   only when the bytes actually changed. Resolves no workflow
                   state and reads no config — standalone, runnable from any
                   directory with <file> given explicitly. This is what the
                   landing script runs ahead of the commit at the human review
                   gate, so no tick ever reaches a commit. Takes no <mode> —
                   it means review-mode file pointers and nothing else, never
                   qa-mode's answered-question boxes. A missing file writes
                   nothing and exits 0
  install          Print a complete, self-contained briefing that teaches an
                   agent (or a human) to build a gtd driver in any shell or
                   runtime — the self-serve version of
                   https://github.com/pmelab/gtd/blob/main/docs/driver.md's
                   'Writing your own driver'. Writes nothing: this installs
                   knowledge into the calling agent's context, not files on disk.
  summary          Print the prompt for an agent to write the process HEAD
                   closes or sits inside its own closing message — the entry
                   commit, each human-authored commit (a review round, an
                   answered question gate), the diff range to inspect, and
                   it.processCost/processCostByModel. Writes nothing: no git,
                   no state transition, no file, no session identity — the
                   driver pipes the output to a cold agent and does what it
                   wants with the result (a squash, an amend, a PR body).
                   Refuses (exit 1) when the workflow declares no summary:
                   template, or when the resolved run has no commits to name
                   — runnable any time before the next thing lands on the
                   branch
  base             Print the review anchor hash — the diff base an external
                   tool (a diff, a PR tool, another agent) should point at —
                   bare, newline-terminated, and nothing else. Writes nothing:
                   no git, no state transition, no session identity. Before
                   the first review round it's the process's diff base;
                   afterward it's the most-recent review round's boundary.
                   Refuses (exit 1) when no process is underway.
  exec             Run the resolved rest's run callback — the step body a
                   workflow wrote as a function rather than a shell string —
                   in the repository root. This is what such a step's script
                   invokes; the driver lands whatever it leaves in the tree.
                   Command output goes to stderr. Exits 1 when the callback
                   throws, or when the resolved rest has no run callback
  judge            Print the resolved rest's pending judgment — the prepared
                   state, its typed questions, and their criteria — the same
                   judge field `gtd next --json` already carries. Read-only:
                   resolves no session, writes nothing. Refuses (exit 1) when
                   the resolved rest declares no judge:
  judge answer     Read a verdict off stdin — one { id, answer, p } entry per
                   question the pending judgment declared — and decode it
                   against an Effect Schema built from those same question
                   ids. Refuses (exit 1) when the resolved rest declares no
                   judge:. Exits 2 (a usage error, like an unknown --json
                   selector) when stdin isn't valid JSON or the verdict
                   doesn't decode against the pending question ids.
  version          Print version and exit
  help             Print this help and exit

Options:
  --json=<path>    (gtd next/gtd land/gtd judge/gtd judge answer only) output
                   structured JSON. Bare --json prints the whole document;
                   --json=<path> (a dotted key path into that document, e.g.
                   kind, content, session.id) prints just that value: a
                   scalar raw and unquoted, a boolean as true/false, a list
                   one JSON entry per line. An absent optional field prints
                   nothing and exits 0 — including when an earlier segment of
                   <path> is itself absent/null (e.g. session.id at a
                   non-prompt rest), which never counts as unknown; an
                   unknown path is a usage error (exit 2).
  --port=<n>       (gtd visualize/gtd ui only) port to serve on: a free port
                   for visualize; for ui, the tailscale serve port (default:
                   the first free of 8443, 10000, 443), or the bind port when
                   --host opts out of serve (default: a free port)
  --no-open        (gtd visualize only) do not open the browser
  --host=<addr>    (gtd ui only) opt out of the default tailscale serve front
                   door and bind this address directly instead, showing it in
                   the printed URL
  --self-signed    (gtd ui only) generate a throwaway self-signed TLS
                   certificate instead of the configured ui.cert/ui.key
  --dev            (gtd ui only) run against local development sources
                   instead of the packaged build
  --cost=<n>       (gtd land only) record the invocation's token cost
  --model=<name>   (gtd land only, with --cost) tag that cost's model
  --entry <state>  (with no command at all) start a brand new process at
                   <state> — any declared state — authenticated as human
  --var <name>=<value>
                   (with --entry; repeatable) supply a fixed it.vars
                   override for the new process; the name must already be
                   declared by the workflow's own vars: or the .gtdrc vars:
  --open-questions (gtd check only) ignore <mode>'s structural findings and
                   instead run the qa open-questions predicate over <file>,
                   printing each unanswered question one per line and exiting
                   non-zero when any remain
  --verbose        enable stderr narration for this invocation: which rest
                   resolved, which declared pattern each pending change
                   matched, and how config resolved across layers. Aliased
                   to -v
  --version, -V    Print version and exit
  --help, -h       Print this help and exit
```

### Plain output is not a parsing surface

`gtd next`'s plain encoding is for a human, or a driver that merely displays it
— never for scraping. Parsing lives in `--json` (bare, or `--json=<path>` to
read one value straight off the same field set — `gtd install`'s briefing has
the full reference); anything that greps, cuts, or `awk`s plain text is
unsupported, and its shape may change across releases with no warning.

### Exit codes

Closed at five numbers, five meanings — a new command never grows this table;
whose turn is next lives in `gtd next --json`'s own `kind` field instead.

| Code      | Meaning          |
| --------- | ---------------- |
| 0         | success          |
| 1         | runtime error    |
| 2         | usage error      |
| 130 / 143 | SIGINT / SIGTERM |

Every command follows this table uniformly, `next`/`land` included: `0` on
success, `1` on refusal, `2` on usage error, `130`/`143` when gtd itself dies by
that signal — a parent's `wait` sees a real signal death (`WIFSIGNALED`), not a
chosen exit code that merely reuses the same number. No command's exit code
carries a second meaning.

**Migration — read this even if you already migrated for a prior release.** This
is the second inversion in as many releases, folded into one note rather than
two to compose in your head: `10`/`20` (whose turn was next) are gone — every
command exits `0`/`1`/`2` uniformly now; `gtd status` is gone (folded into
`gtd next`); and plain `gtd next` now prints a status header at every kind
EXCEPT `prompt` — agent input is untouched, since plain `gtd next` at a `prompt`
rest is byte-identical to before. A driver must read whose turn is next off
`gtd next --json`'s own `kind` field
(`capture`/`message`/`script`/`prompt`/`stalled`) — never off gtd's exit code,
which no longer carries that signal at all.

Every usage mistake — an unknown option or command, missing/extra arguments, a
scope violation (e.g. `--cost` on a command other than `gtd land`), a bad flag
value — is a USAGE error (`2`), never a runtime error (`1`): nothing was even
attempted. `--help`/`--version` still exit `0`.

`--version` (`-V`) / `gtd version` and `--help` (`-h`) / `gtd help`
short-circuit before any git or repository-state work — they run outside a repo
and in any repo state, and print to **stdout** at exit 0. `--verbose` (`-v`) is
not a short-circuit — it gates narration for whatever command follows (see
[Narration and remediation](#narration-and-remediation) below). Bare `gtd` (no
subcommand) is a usage error that exits 2 — gtd decides and prints, full stop;
driving a loop is a driver's job, not a bundled command (see
[Driving the loop](./driver.md#driving-the-loop)) — printing its help text to
**stderr**, not stdout: stdout stays byte-empty on every failure, a usage error
included (see [Error envelope](#error-envelope) below). Any other, truly unknown
subcommand is likewise a usage error exiting 2 without touching the repository.
The state commands (`land`, `--entry`, `abandon`, `restore`, `next`, `status`,
`validate`, `summary`, `ui`, `judge`, `judge answer`) must run from the
**repository root** — gtd derives the workflow, pending changes, and process
history relative to cwd, so they refuse with a clear error from a subdirectory;
`lsp`, `init`, `visualize`, `check`, and `uncheck` are standalone and run from
anywhere (see each command's own help entry).

`install` is described on its own above: it writes nothing and installs
knowledge into the calling agent's context, not files on disk.

`--json`, `--cost=<n>`, `--model=<name>` (the latter two only for `gtd land`),
`--entry <state>` (no other command at all), and `--var <name>=<value>` (with
`--entry`, repeatable) are the only long options the compiled bundle recognizes.
`--entry`/`--var` accept both the `--flag=value` and the space-separated
`--flag value` form. Any other `--` option (including a typo like `--jsn`) is
rejected with a usage error rather than silently ignored, so a mistyped flag can
never degrade a JSON caller to plain-text mode. `--var` with no `--entry`, a
duplicate `--var` name, or `--cost`/`--model`/`--entry` combined with another
command are all usage errors too — landing and entering are different verbs, so
`gtd land --entry <state>` is a usage error, not a synonym. A bare
`--cost`/`--model` with no value, a non-numeric or negative `--cost`, an empty
`--model`, `--model` without `--cost`, or `--cost`/`--model` on any command
other than `gtd land` are all usage errors.

### `gtd next`'s `Next:`/`next`

Both plain and `--json` output include a preview of where the pending changes
would take the process: gtd replays the workflow as if the working tree were
landed now and reports the step it would reach, alongside the step-graph
condition that leads there (empty when the step follows unconditionally). Plain
output prints a `Next: <condition> → <step>` line (or
`Next: (no match — nothing would happen)` on a clean tree); `--json`'s `next`
key mirrors it as `{ pattern, target }`, or `null`. It is a preview, not a
landing: a guard or a `refuse()` can still turn the real `gtd land` away.

### Error envelope

**stdout is either the complete artifact or byte-empty — never a partial write
followed by an error.** Every command buffers everything it would print and
flushes that buffer to stdout exactly once, only after it succeeds; on any
failure the buffer is simply discarded, so stdout never carries a half-written
prompt/script alongside a message about why it stopped. `gtd visualize` is the
one exception worth knowing: it flushes its served-URL line immediately, before
blocking on `Ctrl-C`, since a flush-on-success would never otherwise fire.

Any invocation that carries `--json` (valid only for `gtd next`/`gtd land` —
every other command usage-errors on it) reports a failure as a machine-readable
envelope on **stderr** — including the scope violation itself, so a driver that
always adds `--json` still gets a parseable envelope on every failure, not only
`gtd next`'s/`gtd land`'s own:

```json
{ "state": "error", "prompt": "<message>" }
```

This covers every failure mode, not just a command's own refusal (exit 1): a
**usage error** (an unknown flag, a missing argument, `gtd --entry version`'s
"not an enterable state" — exit 2) and a **defect** (a layer throwing outside
the ordinary error channel — exit 1) both get the same envelope shape — there is
no failure path that reaches `--json` without one — but a usage error's exit
code is 2, never 1, so a driver can tell "you invoked gtd wrong" apart from "gtd
refused/broke" (see [Exit codes](#exit-codes)).

A human-readable `gtd: <message>` line is also always written to **stderr**,
right after the envelope — stdout carries neither one on a failing run. Stderr
always carries exactly one `gtd: ` prefix: a message already authored with its
own `gtd:`/`gtd <cmd>:` prefix is never doubled.

### Narration and remediation

Stderr carries two things beyond the `gtd: ` message line above: NARRATION,
gated by `--verbose`/`-v`, and REMEDIATION, unconditional.

`--verbose` (alias `-v`) turns on one line of commentary per in-process fact a
command's dispatch already computes — which rest resolved, and how config
resolved across `.gtdrc` layers. Without it, none of this is printed; stdout is
never touched either way — narration is a stderr-only concern, exactly like the
error envelope above.

A failure's remediation detail is unconditional — it prints at every verbosity,
on the line(s) right after the `gtd: `-prefixed message, each indented two
spaces: a bad config key names the offending key and which `.gtdrc` layer it
came from, and a corrupted ref names the ref. (A steering mode's `format:`/
`validate:` command naming its own missing binary and the resolved `$PATH` is a
DIFFERENT thing — that line is printed by the driver's shell to the emitted
script's own stdout, unindented, not by gtd on stderr; see
docs/configuration.md's "A missing binary in `format:`/`validate:` fails loudly,
before it runs".)

### Non-interactive today

gtd is non-interactive: no readline, no `/dev/tty`, and no prompt call anywhere.
If interaction is ever added, it goes to `/dev/tty`, never stderr, and never
blocks — a question fails with a code when the tty cannot be opened rather than
hanging. The reason is the section above: stderr already has two occupants,
narration and remediation, and a question mixed into that stream would deadlock
a driver that never reads stderr.
