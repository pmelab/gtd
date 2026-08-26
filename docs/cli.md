# CLI reference

## Commands

```
Usage: gtd [command] [options]

Commands:
  init             Scaffold a minimal .gtdrc.json for this repo, seeding the
                   default variables you are most likely to change (the test
                   command) and a Prettier formatting suggestion. gtd runs its
                   built-in workflow by default, so no workflow is written —
                   add a workflow: key only to customize the machine itself.
                   Takes no argument. Run once per repo; refuses if a gtd
                   config already exists. Leaves the file uncommitted for you
                   to review and commit
  land             Land whatever the tree now shows at the currently resolved
                   rest — a human capture, an agent/check turn, or an empty
                   attempt (a fruitless prompt turn). Pass
                   --cost=<n> (optionally --model=<name>) to record the
                   just-finished invocation's token cost and model on the
                   turn commit (summed into it.processCost/
                   processCostByModel). Plain (the default) prints ONLY the
                   script that records the landing; a driver runs it, e.g.
                   `gtd land | sh`. --json/--sh instead emit script (that
                   same script, byte-identical) alongside settled, idle,
                   state (the post-land target), subject, cost and model —
                   --json/--sh are mutually exclusive. Exits 0 on success, 1
                   on any refusal — see the Exit codes section below
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
                   status summary, a blank line, then the step verbatim —
                   except at a prompt rest, which is the bare step (plus the
                   self-validation instruction when applicable) with no
                   header, since those bytes are the agent's own input. --json
                   emits the one structured surface gtd has: kind
                   (capture|message|script|prompt|stalled) selects what a
                   driver does, content is what it runs or shows, idle marks
                   the workflow's initial state with a clean tree, plus the
                   prompt session, model, validate script, log path, changes,
                   next and the resting state's own fields. --sh emits the
                   same fields as gtd_-prefixed POSIX shell assignments.
                   --json/--sh are mutually exclusive. Exits 0 — see the
                   Exit codes section below
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
  version          Print version and exit
  help             Print this help and exit

Options:
  --json           (gtd next/gtd land only) output structured JSON
                   instead of plain text. Mutually exclusive with --sh
  --sh             (gtd next/gtd land only) output gtd_-prefixed POSIX
                   shell assignments instead of plain text. Mutually
                   exclusive with --json
  --port=<n>       (gtd visualize only) port to serve on (default: a free port)
  --no-open        (gtd visualize only) do not open the browser
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
— never for scraping. Parsing lives in `--json`/`--sh`, both of which read from
the exact same field set (`gtd install`'s briefing has the full reference);
anything that greps, cuts, or `awk`s plain text is unsupported, and its shape
may change across releases with no warning.

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
`validate`, `summary`) must run from the **repository root** — gtd derives the
workflow, pending changes, and process history relative to cwd, so they refuse
with a clear error from a subdirectory; `lsp`, `init`, `visualize`, and `check`
are standalone and run from anywhere (see each command's own help entry).

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

Both plain and `--json` output include a headline preview of what would happen
next: the first declared `on` edge whose pattern matches the pending changes AS
A WHOLE (the same first-match-wins semantics `gtd land` itself uses), using its
`action` when the edge declares one, else its raw pattern, alongside its target
state. Plain output prints a `Next: <action-or-pattern> → <target>` line (or
`Next: (no match — nothing would happen)`); `--json`'s `next` key mirrors it as
`{ action?, pattern, target }`, or `null` on no match.

This reports the **declared** route only: a capped `retry` may redirect
elsewhere when the land is decided, which `Next:`/`next` does not apply — it
previews what the declared `on` patterns would match, not a guarantee of where a
real `gtd land` lands.

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

**Accepted cost:** a driver that pipes stdout into `jq` on a failed run now
reads nothing instead of a parseable error object — it must read stderr or the
exit code to learn why a run failed.

### Narration and remediation

Stderr carries two things beyond the `gtd: ` message line above: NARRATION,
gated by `--verbose`/`-v`, and REMEDIATION, unconditional.

`--verbose` (alias `-v`) turns on one line of commentary per in-process fact a
command's dispatch already computes — which rest resolved, which declared
pattern each pending change matched, and how config resolved across `.gtdrc`
layers. Without it, none of this is printed; stdout is never touched either way
— narration is a stderr-only concern, exactly like the error envelope above.

A failure's remediation detail is unconditional — it prints at every verbosity,
on the line(s) right after the `gtd: `-prefixed message, each indented two
spaces: a bad config key names the offending key and which `.gtdrc` layer it
came from, a corrupted ref names the ref, and a missing binary in a steering
mode's `format:`/`validate:` command names the resolved `$PATH` it was looked up
in.

### Non-interactive today

gtd is non-interactive: no readline, no `/dev/tty`, no prompt call anywhere in
`src/`. If interaction is ever added, it goes to `/dev/tty`, never stderr, and
never blocks — a question fails with a code when the tty cannot be opened rather
than hanging. The reason is the section above: stderr already has two occupants,
narration and remediation, and a question mixed into that stream would deadlock
a driver that never reads stderr.
