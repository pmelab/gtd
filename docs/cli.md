# CLI reference

## Commands

```
Usage: gtd <command> [options]

gtd reads a repository's git state and prints what should happen next in its
workflow. It never acts on it: a driver, or you, runs what it prints.

Core loop:
  next                      Print what should happen next
  land                      Record what the tree now shows
  validate                  Print the script that checks the steering file

Start and stop:
  start [name] [args...]    Start a workflow or door; bare, list them
  abandon                   Stop the process, keeping its changes
  restore                   Bring back the last abandoned process
  repin                     Pin the process to the live gtd and workflow

Inspect:
  summary                   Print the prompt for the closing message
  base                      Print the commit a review diff starts from
  strays <range> [glob...]  List changed files outside the globs
  history list              List finished processes
  history show <ref>        Replay one finished process
  history metrics [ref...]  Report cost and rework of finished processes
  history judges [ref...]   Calibrate the judges of finished processes
  history fetch [remote]    Print a script that fetches finished processes
  ui                        Serve the web and phone client

Driver plumbing:
  guide                     Print a briefing for writing a driver
  bundle                    Print the pin of the current workflow
  judge                     Print the pending judgment
  judge answer              Land a verdict read from stdin
  judge run                 Answer a judgment with a model
  check <mode> <file>       Check a steering file's format
  uncheck <file>            Untick a review file's boxes
  lsp                       Start the steering-file language server
  help [command]            Print help for gtd or one command
  version                   Print the version

Options:
  -v, --verbose             Narrate on stderr what gtd resolved
  --live                    Run this gtd, not the process's pin; it may misread
                            the process
  -h, --help                Print help; gtd <command> --help for one command
  -V, --version             Print the version
  --                        End the options: every word after it is an argument

Examples:
  $ gtd start                                   list what can start
  $ gtd start <name>                            start a process
  $ gtd next                                    see what happens next
  $ s=$(gtd land --json=script) && sh -c "$s"   land the turn
  $ gtd help land                               one command's details

Run `gtd help <command>` for a command's details and options, and `gtd guide` to
learn how to drive gtd.
```

`gtd help <command>` — or `gtd <command> --help` — prints one command's own
help; every one is under [Every command](#every-command).

### Plain output is not a parsing surface

`gtd next`'s plain encoding is for a human, or a driver that merely displays it
— never for scraping. Parsing lives in `--json` (bare, or `--json=<path>` to
read one value straight off the same field set — `gtd guide`'s briefing has the
full reference); anything that greps, cuts, or `awk`s plain text is unsupported,
and its shape may change across releases with no warning.

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
Plain `gtd next` prints a status header at every kind; at `prompt` it goes to
stderr, since stdout is exactly the agent's input.

Every usage mistake — an unknown option or command, missing/extra arguments, a
scope violation (e.g. `--cost` on a command other than `gtd land`), a bad flag
value, an unknown `gtd check` mode, a `--var` the workflow does not declare, a
stdin that `gtd judge run` or `gtd judge answer` cannot read — is a USAGE error
(`2`), never a runtime error (`1`): nothing was even attempted.
`--help`/`--version` still exit `0`.

`--version` (`-V`) / `gtd version` and `--help` (`-h`) / `gtd help`
short-circuit before any git or repository-state work — they run outside a repo
and in any repo state, and print to **stdout** at exit 0. `--verbose` (`-v`) is
not a short-circuit — it gates narration for whatever command follows (see
[Narration and remediation](#narration-and-remediation) below). Bare `gtd` (no
subcommand) is a usage error that exits 2 — gtd decides and prints, full stop;
driving a loop is a driver's job, not a bundled command (see
[Driving the loop](./driver.md#driving-the-loop)) — printing a short usage to
**stderr**, not stdout: stdout stays byte-empty on every failure, a usage error
included (see [Error envelope](#error-envelope) below). Any other, truly unknown
subcommand is likewise a usage error exiting 2 without touching the repository;
its message names the nearest command when it looks like a typo of one. The
state commands (`land`, `start`, `abandon`, `restore`, `repin`, `next`,
`validate`, `summary`, `ui`, `judge`, `judge answer`, `history list`,
`history show`, `history fetch`) must run from the **repository root** — gtd
derives the workflow, pending changes, and process history relative to cwd, so
they refuse with a clear error from a subdirectory; `lsp`, `check`, `uncheck`
and `strays` are standalone and run from anywhere (see each command's own help
entry).

`guide` is described on its own above: it installs knowledge into the calling
agent's context — including where to get a workflow, since gtd ships none — and
writes nothing.

Each long option is valid only on the commands whose help lists it; any other
`--` option (including a typo like `--jsn`) is rejected with a usage error
rather than silently ignored, so a mistyped flag can never degrade a JSON caller
to plain-text mode. A value takes the `--flag=value` form; `--var` and
`--threshold` also take the space-separated `--flag value` form, and `--json`
takes only `--json=<path>`. `--` ends the options: every word after it is an
argument, even one starting with `-`, and `--help`/`--version` after it are no
short-circuit.

`--model` means two things: on `gtd land` (with `--cost`) the model to record
that cost against, on `gtd judge run` the model that answers. `--var` pins a
process setting on `gtd start <name>` only. A duplicate `--var` name, `--var` on
bare `gtd start`, or `--cost`/`--model` on a command they are not valid for are
usage errors too — landing and starting are different verbs.

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
**usage error** (an unknown flag, a missing argument, `gtd start nope`'s "no
workflow or door is named" — exit 2) and a **defect** (a layer throwing outside
the ordinary error channel — exit 1) both get the same envelope shape — there is
no failure path that reaches `--json` without one — but a usage error's exit
code is 2, never 1, so a driver can tell "you invoked gtd wrong" apart from "gtd
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
`judge`), and the script document. Bare `gtd start --json` is a bare array and
carries none.

The script document is what every other command that prints a script prints
under `--json` — `gtd start <name>`, `gtd abandon`, `gtd restore`, `gtd repin`,
`gtd validate` and `gtd history fetch`:

```json
{ "schema": 1, "script": "<the script, ending in one newline>" }
```

`--json=script` prints the script alone, so every command that changes anything
is run the same way:

```sh
s=$(gtd abandon --json=script) && sh -c "$s"
```

Without `--json` these commands print the same script, and plain `gtd land` and
`gtd judge answer` keep naming the commit instead. `gtd validate`'s script is
empty when the step declares no file to check. `gtd summary`, `gtd base` and
`gtd check` take no `--json`: they print a prompt, a hash or findings, never a
script, and `gtd check`'s verdict is its exit code.

- `schema` is bumped only when a field is removed or renamed.
- Adding a field never bumps it: a driver ignores keys it does not know.
- `schema` is not gtd's package version. A driver installed apart from gtd
  checks it and refuses a value it does not read.

### Narration and remediation

Stderr carries four things beyond the `gtd: ` message line above: NARRATION,
gated by `--verbose`/`-v`, REMEDIATION, unconditional, a WARNING, which
`gtd history show` prints when a finished process was recorded by another gtd
version, and plain `gtd next`'s status header at a `prompt` rest. When it
refuses because of config drift or replay divergence, the warning is the last
line of the refusal message (and of the `--json` `prompt`) instead of its own
line.

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

## Pinned processes

A process runs on its pin, `.gtd/process.gtdpin`, which its
[pin beat](driver.md#pin-and-unpin-beats) commits. The `gtd` on `PATH` looks for
that file in the worktree, or in HEAD once the unpin beat has deleted it, and
runs the command on the engine and workflow the pin carries, in the same Node
process: output, exit code and signal death are the pin's. Editing
`gtd.config.ts`, a module it imports, or upgrading gtd mid-process changes
nothing about the process. A command that reads the rest notes the config files
that differ from the pinned ones:

```
gtd: notice: the live config differs from the pinned one (lib/flow.ts); `gtd repin` to switch
```

These never run on the pin: `ui`, `lsp`, `guide`, `bundle`, `repin`, `help`,
`version` and the `history` commands. `gtd version` (and `-V`) adds the pin's
version: `<version> (this process is pinned to gtd <version>)`. `--verbose`
narrates the hand-over as `launcher: running the pin <path> (gtd <version>)`.

`--live`, accepted before any command, runs the `gtd` on `PATH` instead of the
pin. It replays the process under the live engine and config, so it may misread
the process.

`gtd repin` switches the process to the live engine and config for good — the
way out when its workflow needs a fix mid-process. Its script runs the pin beat
again and lands it as `gtd(check): gtd:pin → <step>` with a `Gtd-Pin: add`
trailer; the process rests where it was, on the new pin. When the live workflow
no longer replays the process, the repin continues from the divergence: its
commit carries a `Gtd-Anchor` naming the last commit the live workflow replays
and names the step it reached there, or `gtd:unpin` when the live flow ends
there (see
[Episodes, replay and divergence](configuration.md#episodes-replay-and-divergence)).
Its script bundles into a temporary file first, so a failing `gtd bundle` leaves
the old pin in place; if the commit itself fails,
`git checkout HEAD -- .gtd/process.gtdpin` puts the old pin back.

The pin's first line is plain text, `gtdpin <format> gtd <version>`, followed by
one gzipped ES module. The format is 1. A pin in another format, or a file there
that is no pin, is refused with exit `1`, naming its format and the gtd that
made it: upgrade gtd. A process started before pins existed has none and runs on
the `gtd` on `PATH`.

## Every command

### `gtd next`

```
Usage: gtd next [options]

Print what should happen next in the process, changing nothing — safe to poll.

Plain output is for a person: a status header (the step, who acts, the pending
changes, where landing them would go), then the step's content. At a prompt the
header goes to stderr, so stdout is exactly the agent's input.

--json prints one JSON document for a driver: its kind (capture, message,
script, prompt or stalled) says what to do, its content what to run or show.
--json=<path> prints one field of it; an unknown path is a usage error (exit 2).

Options:
  --json[=<path>]     Print the JSON document, or with --json=<path> one field
                      of it (e.g. --json=kind): a scalar bare, a list one entry
                      per line, nothing for an absent field
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd land`

```
Usage: gtd land [options]

Record what the working tree now shows at the current step: a person's edit, an
agent's or a check's turn, or an empty attempt when an agent changed nothing.

gtd writes nothing itself. Plain output names the commit it would make;
--json=script prints the script that makes it:

  s=$(gtd land --json=script) && sh -c "$s"

--json prints the whole document: the script, the step the process lands at, the
commit subject, and the recorded cost and model. A refusal exits 1.

Options:
  --json[=<path>]     Print the JSON document, or with --json=<path> one field
                      of it (e.g. --json=kind): a scalar bare, a list one entry
                      per line, nothing for an absent field
  --cost=<n>          Record the token cost of the invocation that just finished
                      on the commit
  --model=<name>      With --cost: the model that cost was spent on — recorded
                      on the commit, nothing runs on it
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd validate`

```
Usage: gtd validate [options]

Print the script that formats, then validates, the current step's steering file
with its mode's commands. gtd runs nothing: the script's exit code is the
verdict, and on a failure it prints a ready-to-send fix prompt. Prints "nothing
to validate" when the step declares no file to check; --json=script then prints
an empty script.

Options:
  --json[=<path>]     Print { schema, script }, or with --json=script the script
                      alone
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd start`

```
Usage: gtd start [name] [args...] [options]

Start a new process: print the script that makes its first commit, which also
commits whatever the working tree holds.

<name> is a door — a named shortcut whose positional args set the workflow's
settings — or else a workflow the config exports, which takes no args. A door
shadows a workflow of the same name. --var pins a setting either way.

  s=$(gtd start <name> --json=script) && sh -c "$s"

With no <name>, list every workflow and door it can start. An unknown <name>,
the wrong number of args, or a --var the workflow does not declare is a usage
error (exit 2); a process already underway is a refusal (exit 1).

Options:
  --json[=<path>]     Print { schema, script }, or with --json=script the script
                      alone. Bare, print the list as a JSON array of { kind,
                      name } (a door adds workflow and args)
  --var <name>=<value>
                      Pin one of the workflow's declared settings for the new
                      process (repeatable); through a door, on top of the
                      settings its args set
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd abandon`

```
Usage: gtd abandon [options]

Stop the process underway without finishing it. The printed script moves HEAD
back to the commit the process started from and keeps everything it produced as
uncommitted changes; `gtd restore` undoes it. With no process underway the
script does nothing.

  s=$(gtd abandon --json=script) && sh -c "$s"

Options:
  --json[=<path>]     Print { schema, script }, or with --json=script the script
                      alone
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd restore`

```
Usage: gtd restore [options]

Bring back the process the last `gtd abandon` stopped: the printed script resets
HEAD to that process's last commit. Refuses on a dirty working tree, when
nothing was abandoned, or when commits made since would be lost.

Options:
  --json[=<path>]     Print { schema, script }, or with --json=script the script
                      alone
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd repin`

```
Usage: gtd repin [options]

Switch the process underway to the live engine and workflow, the way out when
the workflow needs a fix mid-process: the printed script runs the pin beat
again, writing `gtd bundle`'s output to .gtd/process.gtdpin and committing that
file alone. Always runs on the gtd on PATH, never on the pin. When the live
workflow no longer replays the process, the commit continues from the
divergence: a Gtd-Anchor trailer names the last commit it replays, the later
commits stay as files only, and the process rests at the step the live workflow
reached there. Refuses when no process is underway, when the next beat is a pin
or unpin beat already, when an unpinned process diverges, or when the live
workflow would continue at the default workflow's first step.

  s=$(gtd repin --json=script) && sh -c "$s"

Options:
  --json[=<path>]     Print { schema, script }, or with --json=script the script
                      alone
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd summary`

```
Usage: gtd summary

Print the prompt for an agent to write the closing message of the process HEAD
closes or sits inside: its first commit, each commit a person made, the diff
range to read, and its cost. Writes nothing — what to do with the answer (a
squash message, a PR body) is the driver's call.

Refuses when the workflow declares no summary template, or when the process has
no commits.

Options:
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd base`

```
Usage: gtd base

Print the commit a review diff should start from, bare: the process's diff base
before the first review round, the latest round's boundary after it. Writes
nothing; refuses when no process is underway.

Options:
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd strays`

```
Usage: gtd strays <range> [glob...] [options]

List the files changed in <range> (<base>..<tip>, an empty side is HEAD) that
match none of the globs. Globs are anchored at the repository root: * stays
within one path segment, ** crosses them, everything else is literal — quote
them in the shell.

Prints a sorted JSON array ([] when clean) and a summary on stderr; --verbose
adds one stray: line per path. Runs in any git repository, no process needed.
Exits 10 when strays were found, 1 on an unknown revision, 2 on a bad range.

Options:
  --json[=<path>]     Print one entry of the array (--json=0), nothing past its
                      end
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd history list`

```
Usage: gtd history list [options]

List the finished processes this clone keeps, newest first: entry, branch, tip,
date and subject. --json prints an array of { ref, entry, branch, tip, date,
subject }. Writes nothing; with none kept it suggests `gtd history fetch`.

Options:
  --json[=<path>]     Print the JSON document, or with --json=<path> one field
                      of it (e.g. --json=kind): a scalar bare, a list one entry
                      per line, nothing for an absent field
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd history show`

```
Usage: gtd history show <ref> [options]

Replay one finished process under today's config and print its steps, judge
verdicts and approvals. <ref> is a full ref, an entry hash or a unique prefix of
one, or a branch name. Refuses when a config file changed since; a different gtd
version only warns. --json prints the trail as one document. Writes nothing.

Options:
  --json[=<path>]     Print the JSON document, or with --json=<path> one field
                      of it (e.g. --json=kind): a scalar bare, a list one entry
                      per line, nothing for an absent field
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd history metrics`

```
Usage: gtd history metrics [ref...] [options]

Report how finished processes went: builds that landed first time or were
rebuilt, cost by model and phase, review findings per lens, and red checks that
passed when re-run — per process and in total. <ref> is read as by
`gtd history show`, but a branch name means every process kept from it; no <ref>
means all of them. Never replays, so a changed config is no reason to refuse.
--json prints { processes, total }. Writes nothing.

Options:
  --json[=<path>]     Print the JSON document, or with --json=<path> one field
                      of it (e.g. --json=kind): a scalar bare, a list one entry
                      per line, nothing for an absent field
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd history judges`

```
Usage: gtd history judges [ref...] [options]

Calibrate the judges of finished processes from their recorded verdicts: per
judge and confidence bucket, how many verdicts later events overturned. <ref> is
read as by `gtd history metrics`. Never replays and asks no model. --json prints
{ processes, total, whatIf }. Writes nothing.

Options:
  --json[=<path>]     Print the JSON document, or with --json=<path> one field
                      of it (e.g. --json=kind): a scalar bare, a list one entry
                      per line, nothing for an absent field
  --threshold <name>=<value>
                      Re-decide every past verdict under this threshold:
                      judgeIdenticalMinP or qualityTriageMinP (repeatable)
  --jsonl             Print one JSON line per verdict instead of the report
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd history fetch`

```
Usage: gtd history fetch [remote] [options]

Print a script that fetches every finished process kept on <remote> (default:
origin) and reports how many arrived. gtd runs no git itself:

  s=$(gtd history fetch --json=script) && sh -c "$s"

Options:
  --json[=<path>]     Print { schema, script }, or with --json=script the script
                      alone
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd ui`

```
Usage: gtd ui [options]

Serve gtd's web and phone client for this worktree. By default it publishes
through `tailscale serve`, reachable from anywhere on the tailnet, on the first
of ports 8443, 10000 and 443 that works; when none does it serves HTTPS locally
instead of refusing.

Options:
  --port=<n>          The tailscale serve port (default: the first free of 8443,
                      10000, 443), or with --host the port to bind (default: any
                      free one)
  --host=<addr>       Bind this address directly instead of publishing through
                      tailscale serve
  --self-signed       Bind directly with a throwaway self-signed certificate
                      instead of the configured ui.cert/ui.key
  --dev               Serve local development sources instead of the packaged
                      build
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd guide`

```
Usage: gtd guide

Print a self-contained briefing that teaches an agent or a person to build a gtd
driver in any shell or runtime, and where to get a workflow — gtd ships none.
Writes nothing.

Options:
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd bundle`

```
Usage: gtd bundle

Print a pin to stdout: gtd's engine and the current workflow — gtd.config.ts,
every module it imports and every npm package they use — as one gzipped ES
module, after a plain-text header line `gtdpin <format> gtd <version>`. Git
diffs it as binary. Refuses a workflow gtd would refuse, and a package that
loads a native addon (.node), naming it. Writes nothing.

Options:
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd judge`

```
Usage: gtd judge [options]

Print the current step's pending judgment: the prepared state, its questions and
their criteria — the judge field `gtd next --json` carries. Writes nothing;
refuses when the step declares no judge.

Options:
  --json[=<path>]     Print the JSON document, or with --json=<path> one field
                      of it (e.g. --json=kind): a scalar bare, a list one entry
                      per line, nothing for an absent field
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd judge answer`

```
Usage: gtd judge answer [options]

Read a verdict from stdin — one { id, answer, p } entry per pending question —
and land it the way `gtd land` does: plain output names the commit,
--json=script prints the script. Refuses when the step declares no judge; a
verdict that is not JSON, or names a question that was not asked, is a usage
error (exit 2).

Options:
  --json[=<path>]     Print the JSON document, or with --json=<path> one field
                      of it (e.g. --json=kind): a scalar bare, a list one entry
                      per line, nothing for an absent field
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd judge run`

```
Usage: gtd judge run [options]

Answer a judgment: read the `gtd judge --json` document from stdin and print the
verdict [{ id, answer, p }] `gtd judge answer` reads. Needs no repository.

The fixed answerer reads --answers and leaves out the questions it does not
cover; jev asks TypeSafe ($TYPESAFE_API_KEY); llm asks the `claude` CLI on PATH.
jev and llm exit 1, printing nothing, when they cannot answer every question. A
stdin that is not a judgment document is a usage error (exit 2).

Options:
  --provider=<name>   The answerer: fixed, jev or llm (default:
                      $GTD_JUDGE_PROVIDER, then ~/.config/gtd/judge.json, then
                      jev when $TYPESAFE_API_KEY is set, else llm)
  --answers=<path>    With --provider fixed: a JSON verdict file [{ id, answer,
                      p }] (default: $GTD_JUDGE_ANSWERS, inline JSON)
  --model=<name>      The claude model the llm answerer uses (default:
                      $GTD_JUDGE_MODEL, then judge.json, then sonnet)
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd check`

```
Usage: gtd check <mode> <file> [options]

Run the steering format <mode> (qa, review or findings, or the declared format
--spec describes) over <file> and print each finding on a line of its own; exits
1 when there are any, or when <file> does not exist. An unknown <mode> is a
usage error (exit 2). Reads no workflow and runs from any directory — emitted
validation scripts call it.

Options:
  --open-questions    Instead of <mode>'s findings, list the unanswered
                      questions in <file>; exits 1 when any remain
  --open-threads      Instead of <mode>'s findings, list the open threads in
                      <file>; exits 1 when any are open. Alone, lists the open
                      code-comment threads in the files the current process
                      changed
  --spec=<json>       Check against the declared format this spec describes,
                      named <mode>, instead of a built-in one; validation
                      scripts pass it for a step whose mode is a declared format
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd uncheck`

```
Usage: gtd uncheck <file>

Reset every ticked review box (- [x]) in <file> to - [ ], writing the file only
when it changes; a missing file writes nothing. Reads no workflow and runs from
any directory — the landing script at a review gate calls it, so no tick is ever
committed.

Options:
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd lsp`

```
Usage: gtd lsp

Start the language server for .gtd/ steering files on stdio.

Options:
  -v, --verbose       Narrate on stderr what gtd resolved
```

### `gtd help`

```
Usage: gtd help [command]

Print gtd's overview, or with <command> that command's own help.
```

### `gtd version`

```
Usage: gtd version

Print gtd's version, and the version of a pinned process's gtd.
```
