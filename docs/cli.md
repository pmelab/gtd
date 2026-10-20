# CLI reference

## Commands

```
Usage: gtd [command] [options]

Commands:
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
  (no command) --workflow <name>
                   Starts a new process authenticated as human, e.g.
                   'gtd --workflow <name>'
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
                   instead (see --help); --open-threads lists open threads.
                   `gtd check --open-threads` alone lists open code-comment
                   threads (`// H: ...`) in the files the process changed;
                   it prints nothing when no process is underway.
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
                   'Writing your own driver'. At a repository root no
                   gtd.config.ts governs yet, it also writes one importing each
                   shipped workflow from @pmelab/gtd/workflows/<name>; anywhere
                   else it writes nothing.
  loop             Drive this worktree's process until it rests on you: read
                   each beat, run the agent turn or script it demands, and
                   land the result. Exits 0 at a human gate, at idle and when
                   a landing settles; exits 1 on a stall or a failed turn or
                   landing. The agent CLI and the model each workflow hint
                   maps to are per-machine settings (GTD_LOOP_* variables, or
                   ~/.config/gtd/loop.json); see docs/driver.md
  context-hook     A Claude Code PostToolUse and PreCompact hook that stops an
                   agent turn at a share of its context window. Reads the
                   hook's input on stdin and the context the transcript's
                   latest assistant message used. Past --soft it blocks with a
                   request to end the turn with a handoff note; past --hard,
                   or at PreCompact, it stops the turn with a stopReason
                   starting "gtd: context limit". Prints nothing otherwise,
                   and for a subagent's tool call. Always exits 0 on valid
                   input; see docs/driver.md
  summary          Print the prompt for an agent to write the process HEAD
                   closes or sits inside its own closing message — the entry
                   commit, each human-authored commit (a review round, an
                   answered question gate), the diff range to inspect, and
                   it.processCost/processCostByModel. Writes nothing: no git,
                   no state transition, no file, no session identity — the
                   driver pipes the output to a cold agent and does what it
                   wants with the result (a squash, an amend, a PR body).
                   --slice <name> prints it for one slice instead: its own
                   range, human commits and cost (see `gtd slices`); it also
                   refuses an unknown slice name, and a HEAD-closing process
                   whose config files differ from the working tree or whose
                   replay diverged; an open last slice is provisional. Refuses
                   (exit 1) when the workflow declares no summary: template,
                   or when the resolved run has no commits to name — plain
                   gtd summary is runnable any time before the next thing
                   lands on the branch
  base             Print the review anchor hash — the diff base an external
                   tool (a diff, a PR tool, another agent) should point at —
                   bare, newline-terminated, and nothing else. Writes nothing:
                   no git, no state transition, no session identity. Before
                   the first review round it's the process's diff base;
                   afterward it's the most-recent review round's boundary.
                   Refuses (exit 1) when no process is underway.
  door <name> [args...]
                   Start a process through a named shortcut, mapping the
                   positional args to that workflow's process settings — the
                   same start `gtd --workflow` makes, printed the same way.
                   Each workflow the config exports brings its own doors (gtd's
                   `fix`, `review [base]`, `rollout <flag>` and
                   `cleanup <flag>`), plus the config's `doors` export. An
                   unknown door, or too few or too many args, is a usage error
                   (exit 2) naming the doors or the door's synopsis
  doors            List every door, sorted: one `name [args] → workflow` line
                   each. --json prints one JSON array of { name, workflow,
                   args: [{ name, optional }] } instead; --json=<path> reads one
                   value off it. Writes nothing
  slices           List the slices of the process HEAD closes or sits inside,
                   first slice first: one `name base..tip` line each (full
                   hashes; plain output carries no promise). --json prints
                   { schema: 1, slices: [{ name, base, tip, closed }] };
                   --json=<path> reads one value off it. Writes nothing: no
                   git, no state transition, no session identity. When HEAD
                   closes a process, every slice is listed as closed; a gtd
                   version mismatch only warns on stderr. Refuses (exit 1)
                   when HEAD neither closes nor sits inside a process, or when
                   today's config disagrees with history about the process:
                   HEAD closes it and its config files differ from the working
                   tree, or the replay diverged
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
  judge run        Answer a judgment: read the `gtd judge --json` document off
                   stdin, write a verdict [{ id, answer, p }] on stdout — what
                   `gtd judge answer` decodes. --provider fixed answers from
                   --answers <path> or GTD_JUDGE_ANSWERS; questions the file
                   does not cover are left out. --provider jev asks TypeSafe
                   (TYPESAFE_API_KEY). --provider llm asks the `claude` CLI
                   on PATH (Claude Code only), model sonnet unless --model.
                   No --provider: GTD_JUDGE_PROVIDER, then ~/.config/gtd/
                   judge.json, else jev when TYPESAFE_API_KEY is set and no
                   model is given, else llm; --model likewise falls back to
                   GTD_JUDGE_MODEL, then the file's model. Needs no
                   repository. jev and llm exit 1 when they cannot answer
                   every question, with nothing on stdout
  strays <range> [glob...]
                   List the files <range> (<base>..<tip>, an empty side is HEAD)
                   touched in its committed net diff that match none of the
                   globs. Anchored at the repo root: * stays within one path
                   segment, ** crosses them, everything else is literal — quote
                   globs in the shell. stdout: a sorted JSON array, [] when
                   clean; stderr: a summary, plus one stray: line per path with
                   --verbose. --json=<n> picks one entry, nothing past the end;
                   a symlink is a path like any other, never followed; a
                   submodule counts as its path, whatever diff.ignoreSubmodules
                   or .gitmodules ignore say. Runs in any git repository, no
                   process needed. Exits 10 when
                   strays were found, 1 on an unknown revision, 2 on a bad range
  history list     List the finished processes kept behind refs/gtd/history/*,
                   newest first: entry, branch, tip, date and subject per line.
                   --json prints one array of { ref, entry, branch, tip, date,
                   subject }. Writes nothing and never replays; with no refs it
                   hints at `gtd history fetch | sh` and still exits 0
  history show <ref>
                   Replay one kept process under today's config and print its
                   steps, judge verdicts and approvals. <ref> is a full ref, an
                   entry hash (or unique prefix) or a branch name. Refuses
                   (exit 1) when a config file differs from its content at the
                   ref's tip. A version mismatch only warns on stderr. --json
                   prints the trail as one document; writes nothing
  history metrics [ref...]
                   Report how the kept processes went: slices whose naive pass
                   landed or was rebuilt (the refactor-first rate), continuations
                   per phase, Gtd-Cost by model and phase with the double work of
                   a rebuild, quality-lap findings per lens, and red checks that
                   passed on their re-check — per process and in total. Each <ref>
                   is read as by history show, but a branch name means every
                   process kept from it; none means every ref.
                   Reads commit subjects and trailers, never replays, so a
                   changed config is no refusal. --json prints { processes, total
                   } as one document; writes nothing
  history judges [ref...]
                   Calibrate the judges of the kept processes from their
                   recorded Gtd-Judge verdicts: per judge (retry, triage, clear)
                   and p bucket, how many verdicts later events overturned.
                   --var <name>=<value> re-decides every past verdict under
                   another threshold and prints what would have changed;
                   --jsonl prints one { process, judge, commit, step, question,
                   state, answer, p, outcome } line per verdict instead. <ref>
                   is read as by history metrics. Never replays and asks no
                   model. --json prints { processes, judges, whatIf }; writes
                   nothing
  history fetch [remote]
                   Print a script that fetches every refs/gtd/history/* from
                   <remote> (default origin) and reports how many arrived — run
                   it with `gtd history fetch | sh`. Never runs git itself
  version          Print version and exit
  help             Print this help and exit

Options:
  --json=<path>    (gtd next/gtd land/gtd judge/gtd judge answer/gtd doors/gtd slices/gtd history
                   list/gtd history show/gtd history metrics/gtd history judges/gtd strays only) output structured JSON. Bare --json prints the whole document;
                   --json=<path> (a dotted key path into that document, e.g.
                   kind, content, session.id) prints just that value: a
                   scalar raw and unquoted, a boolean as true/false, a list
                   one JSON entry per line — a numeric segment (e.g.
                   skills.0) indexes into one entry of a list field instead.
                   An absent optional field prints nothing and exits 0 —
                   including when an earlier segment of <path> is itself
                   absent/null (e.g. session.id at a non-prompt rest), which
                   never counts as unknown; an unknown path is a usage error
                   (exit 2).
  --port=<n>       (gtd ui only) the tailscale serve port (default: the first
                   free of 8443, 10000, 443), or the bind port when --host
                   opts out of serve (default: a free port)
  --host=<addr>    (gtd ui only) opt out of the default tailscale serve front
                   door and bind this address directly instead, showing it in
                   the printed URL
  --self-signed    (gtd ui only) generate a throwaway self-signed TLS
                   certificate instead of the configured ui.cert/ui.key
  --dev            (gtd ui only) run against local development sources
                   instead of the packaged build
  --provider=<name>
                   (gtd judge run only) the answerer: fixed | jev | llm;
                   omitted: GTD_JUDGE_PROVIDER, then judge.json, then jev
                   when TYPESAFE_API_KEY is set, else llm
  --answers=<path> (gtd judge run --provider fixed only) a JSON verdict array
                   [{ id, answer, p }]; else the GTD_JUDGE_ANSWERS env var
                   (inline JSON) is read
  --cost=<n>       (gtd land only) record the invocation's token cost
  --model=<name>   (gtd land, with --cost) tag that cost's model
                   (gtd judge run, llm answerer) the claude model; omitted:
                   GTD_JUDGE_MODEL, then judge.json, then sonnet
  --soft=<share>   (gtd context-hook only) the soft limit; default 0.6
  --hard=<share>   (gtd context-hook only) the hard limit; default 0.7
  --window=<tokens>
                   (gtd context-hook only) the model's context window in
                   tokens; default 200000
  --slice=<name>   (gtd summary only) the closing-message prompt for one
                   slice, named as `gtd slices` lists it: its own range, human
                   commits and cost. An unknown name is refused (exit 1) with
                   every valid slice listed
  --workflow <name>
                   (with no command at all) start a brand new process on
                   the named workflow — authenticated as human
  --var <name>=<value>
                   (with --workflow; repeatable) pin a process setting for the
                   new process; the name must already be declared by the
                   workflow's defaults (environment settings are not
                   pinnable). (gtd history judges) re-decide past verdicts
                   under this threshold: judgeIdenticalMinP or
                   qualityTriageMinP
  --jsonl          (gtd history judges only) print one JSON line per verdict
                   instead of the report
  --open-questions (gtd check only) ignore <mode>'s structural findings and
                   instead run the qa open-questions predicate over <file>,
                   printing each unanswered question one per line and exiting
                   non-zero when any remain
  --open-threads   (gtd check only) ignore <mode>'s structural findings and
                   instead list every open thread (a footnote whose last
                   entry is the agent's) over <file>, one per line with its
                   first H entry, exiting non-zero when any are open. With no
                   <mode>/<file>, lists code-comment threads in the files the
                   current process changed (read from its diff base, unlike
                   the rest of `gtd check`)
  --verbose        enable stderr narration for this invocation: which rest
                   resolved and how config resolved across layers. Aliased
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

Frozen: adding a code is a format break, shipped as a major release (not a
`schema` bump). Whose turn is next lives in `kind`.

| Code      | Meaning                          |
| --------- | -------------------------------- |
| 0         | success                          |
| 1         | runtime error                    |
| 2         | usage error                      |
| 10        | strays found (`gtd strays` only) |
| 130 / 143 | SIGINT / SIGTERM                 |

Stability tiers: see [COMPATIBILITY.md](../COMPATIBILITY.md).

Every command follows this table uniformly, `next`/`land` included: `0` on
success (`gtd strays` alone may exit `10`), `1` on refusal, `2` on usage error,
`130`/`143` when gtd itself dies by that signal — a parent's `wait` sees a real
signal death (`WIFSIGNALED`), not a chosen exit code that merely reuses the same
number. No command's exit code carries a second meaning.

A history written in a format this gtd does not read is a refusal like any
other: exit `1`, with a message naming the found and supported formats (see
[History format](./configuration.md#history-format)).

A driver reads whose turn is next off `gtd next --json`'s own `kind` field
(`capture`/`message`/`script`/`prompt`/`stalled`), never off gtd's exit code.
Plain `gtd next` prints a status header at every kind except `prompt`, whose
output is exactly the agent's input.

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
The state commands (`land`, `--workflow`, `door`, `doors`, `slices`, `abandon`,
`restore`, `next`, `status`, `validate`, `summary`, `ui`, `judge`,
`judge answer`, `history list`, `history show`, `history fetch`) must run from
the **repository root** — gtd derives the workflow, pending changes, and process
history relative to cwd, so they refuse with a clear error from a subdirectory;
`lsp`, `check`, `uncheck` and `strays` are standalone and run from anywhere (see
each command's own help entry).

`install` is described on its own above: it installs knowledge into the calling
agent's context, and at a repository root no `gtd.config.ts` governs yet, the
config that runs gtd's shipped workflows.

`--json`, `--cost=<n>`, `--model=<name>` (`--cost` only for `gtd land`;
`--model` for `gtd land` with `--cost`, or `gtd judge run`), `--workflow <name>`
(no other command at all), and `--var <name>=<value>` (with `--workflow`,
repeatable) are the only long options the compiled bundle recognizes.
`--workflow`/`--var` accept both the `--flag=value` and the space-separated
`--flag value` form. Any other `--` option (including a typo like `--jsn`) is
rejected with a usage error rather than silently ignored, so a mistyped flag can
never degrade a JSON caller to plain-text mode. `--var` with no `--workflow`, a
duplicate `--var` name, or `--cost`/`--model`/`--workflow` combined with another
command are all usage errors too — landing and entering are different verbs, so
`gtd land --workflow <name>` is a usage error, not a synonym. A bare
`--cost`/`--model` with no value, a non-numeric or negative `--cost`, an empty
`--model`, `--model` without `--cost` on `gtd land`, `--cost` on any command
other than `gtd land`, or `--model` on any command other than `gtd land` and
`gtd judge run` are all usage errors.

### `gtd next`'s `Next:`/`next`

Both plain and `--json` output include a preview of where the pending changes
would take the process: gtd replays the workflow as if the working tree were
landed now and reports the step it would reach. Plain output prints a
`Next: → <step>` line (or `Next: (nothing would land)` when landing would commit
nothing); `--json`'s `next` key mirrors it as `{ target }`, or `null`. It is a
preview, not a landing: a guard or a `refuse()` can still turn the real
`gtd land` away.

### Error envelope

**stdout is either the complete artifact or byte-empty — never a partial write
followed by an error.** Every command buffers everything it would print and
flushes that buffer to stdout exactly once, only after it succeeds; on any
failure the buffer is simply discarded, so stdout never carries a half-written
prompt/script alongside a message about why it stopped. `gtd ui` is the one
exception worth knowing: it flushes its served-URL line immediately, before
blocking on `Ctrl-C`, since a flush-on-success would never otherwise fire.

Any invocation that carries `--json` (valid only for
`gtd next`/`gtd land`/`gtd strays` and the other commands whose help names it —
every other command usage-errors on it) reports a failure as a machine-readable
envelope on **stderr** — including the scope violation itself, so a driver that
always adds `--json` still gets a parseable envelope on every failure, not only
`gtd next`'s/`gtd land`'s own:

```json
{ "state": "error", "prompt": "<message>" }
```

This covers every failure mode, not just a command's own refusal (exit 1): a
**usage error** (an unknown flag, a missing argument, `gtd --workflow nope`'s
"unknown workflow" — exit 2) and a **defect** (a layer throwing outside the
ordinary error channel — exit 1) both get the same envelope shape — there is no
failure path that reaches `--json` without one — but a usage error's exit code
is 2, never 1, so a driver can tell "you invoked gtd wrong" apart from "gtd
refused/broke" (see [Exit codes](#exit-codes)).

A human-readable `gtd: <message>` line is also always written to **stderr**,
right after the envelope — stdout carries neither one on a failing run. Config
warnings (`gtd: warning: …`) may precede the envelope. The error line carries
exactly one `gtd: ` prefix: a message already authored with its own
`gtd:`/`gtd <cmd>:` prefix is never doubled.

### Schema

Every JSON document a driver reads carries a top-level integer `schema`,
currently `1`: `gtd next --json` (every beat kind), `gtd land --json`,
`gtd judge answer --json`, `gtd judge --json` (also the string a beat carries in
`judge`), and `gtd slices --json`. `gtd doors --json` is a bare array and
carries none.

- `schema` is bumped only when a field is removed or renamed.
- Adding a field never bumps it: a driver ignores keys it does not know.
- `schema` is not gtd's package version. A driver installed apart from gtd
  checks it and refuses a value it does not read.

### Narration and remediation

Stderr carries three things beyond the `gtd: ` message line above: NARRATION,
gated by `--verbose`/`-v`, REMEDIATION, unconditional, and a WARNING, which
`gtd slices`, `gtd summary --slice` and `gtd history show` print when a finished
process was recorded by another gtd version (with `--json` too, for
`gtd slices`). When such a command refuses because of config drift or replay
divergence, the warning is the last line of the refusal message (and of the
`--json` `prompt`) instead of its own line.

`--verbose` (alias `-v`) turns on one line of commentary per in-process fact a
command's dispatch already computes — which rest resolved, and which
`gtd.config.ts` the config came from. Without it, none of this is printed;
stdout is never touched either way — narration is a stderr-only concern, exactly
like the error envelope above.

A failure's remediation detail is unconditional — it prints at every verbosity,
on the line(s) right after the `gtd: `-prefixed message, each indented two
spaces: a bad config key names the offending key and the file it came from, and
a corrupted ref names the ref. (A steering mode's `format:`/ `validate:` command
naming its own missing binary and the resolved `$PATH` is a DIFFERENT thing —
that line is printed by the driver's shell to the emitted script's own stdout,
unindented, not by gtd on stderr; see docs/configuration.md's "A missing binary
in `format:`/`validate:` fails loudly, before it runs".)

### Non-interactive today

gtd is non-interactive: no readline, no `/dev/tty`, and no prompt call anywhere.
If interaction is ever added, it goes to `/dev/tty`, never stderr, and never
blocks — a question fails with a code when the tty cannot be opened rather than
hanging. The reason is the section above: stderr already has several occupants,
narration, remediation and warnings, and a question mixed into that stream would
deadlock a driver that never reads stderr.
