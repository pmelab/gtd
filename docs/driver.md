# Driver protocol

## Driving the loop

gtd itself is not a loop — it decides and prints, full stop; driving a loop is a
driver's job. The minimal driver below (see
[A complete minimal driver](#a-complete-minimal-driver)) is that driver: save it
as `~/.local/bin/gtd-loop`, `chmod +x` it, and run it from a repository root —
it takes no arguments and runs the loop until it's your turn. It drives the
autonomous states (agent turns, check runs) and stops at the first
non-autonomous one: reaching a human gate it prints the gate's message and
exits. You act by editing files (answer a plan question, tick a review box, fix
code) and re-running it — your pending edit arrives as the loop's first beat
(`kind: "capture"`, landed immediately), so you never run `gtd land` by hand.

Some gates could accept by INACTION instead: a workflow may declare a `"C"`
(clean-tree) pattern on a human-actor state that routes onward, so changing
nothing there means "accept as-is" rather than nothing happening. That reaches
the driver as `kind: "message"` either way, which no inspection can tell apart
from a gate you have not read yet — so the driver treats its OPENING beat as
yours regardless and lands it: you re-ran it while resting there, and that
invocation IS the decision. Every later beat halts as usual, because a gate the
driver produced mid-run is one you have not seen. Landing an opening beat at a
gate with no `"C"` pattern is harmless — a benign no-op (see `gtd land`'s exit
codes below) — and the gate then prints on the next beat. A mid-process restart
simply resumes driving from whatever beat is actually next.

Anything richer at that boundary — opening your editor, desktop notifications,
terminal-multiplexer status — is the job of an outer wrapper around the driver,
not of the loop itself; see
[Terminal-multiplexer status: a herdr wrapper](#terminal-multiplexer-status-a-herdr-wrapper)
below for a worked example.

A workflow state can declare an optional `label:` — a human-readable display
name surfaced in `gtd next --json`/plain `gtd next`. The driver uses it for its
per-beat progress lines; an outer wrapper (a terminal multiplexer, a notifier)
can use it the same way.

A machine may also declare `system:` — like `model:`, stamped once at the
machine level onto every one of that machine's own `prompt` states, never
authored on an individual state. It is passed to the agent CLI as (in the
reference driver's case) `--system-prompt`, which **replaces** the harness's own
default system prompt outright rather than appending to it (contrast with an
`--append-system-prompt`-shaped flag) — so a machine declaring `system:` loses
not only the harness's own tool-use instructions but also its dynamic per-turn
sections: current working directory, environment info, memory-path information,
git status. A workflow author reaching for `system:` for the first time is
therefore writing a complete replacement system prompt, not a tweak on top of
the harness's own. The scoping is machine-level for the same reason memory is
machine-scoped below: a machine is the unit of conversational identity, so its
system prompt — like its model tier — is one property of that identity, constant
across every turn of the one resumed session, never a per-state override. Like
`model:`/`file:`, a `system:` value prefixed `./` or `../` is inlined from the
declaring config file's own directory at compile time — for a user's own
`.gtdrc` `workflow:` config only; the bundled template ships no filesystem
references at all, since it has to work inside a single-file build. The bundled
default template ships six such personas already, one per prompt-bearing machine
— `designPersona`, `architectPersona`, `reviewerPersona`, `specReviewerPersona`,
`builderPersona`, `finisherPersona` — and, like any other bundled var, each is
overridable through a top-level `.gtdrc` `vars:` key or a `GTD_<NAME>`-style
environment variable (e.g. `GTD_DESIGNPERSONA`) — gtd's existing, generic
vars-override mechanism, nothing new. Each persona var carries only that
machine's own role paragraph; a shared `agentConduct` var (tool-use conduct,
orienting with git since there is no injected status block, and inspecting what
the turn's own message names) is appended after it at all six sites, so the six
identities differ only in role, never in how they're told to behave.

Memory is **entry-scoped to a machine**, not a state-authored label: each
machine instance (a node in the `machines:` tree, e.g. `build`, `build.health`,
`packages.item`, `packages.item.health`) owns its own conversational scope, and
a `prompt`-content state's `memory` key — surfaced in `gtd next --json`'s
`memory` field, and as a `Memory: <key>` line in plain `gtd next` — is computed,
never authored, as `<scope>#<hash7>`: `<scope>` is that machine instance's
dotted path (the root instance is shown as `root`), and `<hash7>` anchors to the
commit the CURRENT unbroken entry into that scope started FROM. Entering a
**descendant** scope (e.g. dipping from `build` into `build.health`) does not
break the parent's unbroken run — a full agent turn in a nested child machine,
then back to the parent, still resumes the SAME parent conversation; entering a
**sibling or unrelated** scope does start a fresh one. The bundled template's
`build.review` (the human review tail) is a worked example: it is nested INSIDE
`build` (the builder's own machine) so that a `gtd --entry fix-precheck` run —
`build.fix` -> `build.health.check` -> `build.review.*` — stays inside one
subtree, letting `build.review.reviewing` resume the SAME session that made the
fixes instead of a root-level sibling forcing it to re-derive the range from
scratch on every pass through the tail. (An actionable review round breaks the
run on purpose instead — it leaves `build` entirely through a root-level
`re-unwind` state and a full re-plan, since a hand-edit made during review is a
sketch to reconsider, not a fix to build on.) Two instances of the same reusable
machine (e.g. `build.health` and `packages.item.health`, both instantiating
`healthGate`) get different scopes and so never share a key, even though they're
the "same shaped" machine. One consequence is a structural guarantee: **a
reviewer's turn never resumes an implementer's session, and vice versa** — a
reviewer machine and the implementer machine it reviews are always different
instances with different scopes.

`gtd` itself stores NOTHING to make this work: `session.id` is
`UUIDv5(<fixed gtd namespace>, <memory key>)` — a deterministic hash of the
computed `<scope>#<hash7>` key above — so the same scope-run always re-derives
the exact same id, and there is no table, no file, no write to keep in sync.
`session.resume` is `true` iff a prior `prompt` turn already landed within that
same scope-run. Because nothing is written, calling `gtd next --json` twice in a
row — a driver's own opening peek, a status poll, a curious human — derives
IDENTICAL `session.id`/`session.resume` values both times, since there is
nothing to poison: looking is free, and there is no separate claiming form to
protect. The per-scope survival story (a child machine's own excursion doesn't
disturb the parent's session) falls out of the key itself, not out of a
per-scope row: the parent's anchor commit is unaffected by whatever the child
scope does in between. A driver maps `session.id`/`session.resume` straight onto
the agent CLI's own session flags — the minimal driver below passes them as
`--session-id <id>`/`--resume <id>` to `claude -p`, but treats `resume` as a
HINT rather than a contract: it tries the flag `resume` points at first and
falls back to the other on failure. That fallback is what recovers BOTH
mismatches that used to need manual intervention — a crashed prior turn that
minted an id but landed no commit (so the next lap re-derives the SAME id with
`resume: false`, and `--session-id` on an already-used id fails, so the driver
falls back to `--resume`), and the inverse (`resume: true`, but the remembered
session is gone — retention expired, `~/.claude/projects` wiped — so `--resume`
fails and the driver falls back to `--session-id`). There is no file to delete
and nothing to restart.

### Terminal-multiplexer status: a herdr wrapper

[herdr](https://herdr.dev) shows a per-pane status in its sidebar. This wrapper
reports `gtd`'s own lifecycle to that status without any herdr-specific
knowledge in `gtd` itself: `working` while the loop drives, `blocked` when it
comes to rest on a human (a gate, a stall, a non-zero exit), and `idle`
(rendered as "done" once the pane's tab is unfocused) when a run ends without
anything owed. It needs nothing from `gtd` beyond `gtd next --sh`'s `gtd_actor`
field — a strictly read-only orientation peek.

Save this as `~/.local/bin/gtdh`, `chmod +x` it, and run `gtdh` in place of
`gtd-loop` — it's a plain bash file, so it works from fish or any other shell.

```bash
#!/usr/bin/env bash
# Report gtd's own lifecycle to the herdr pane it runs in: working while the
# loop drives, blocked when it rests on you, idle (shown as "done") otherwise.
# Needs nothing from gtd but `gtd next --sh`. Outside herdr it is a plain
# passthrough.
set -uo pipefail

pane="${HERDR_PANE_ID:-}"

# `--agent gtd` is deliberate: herdr only lets screen detection (or a visible
# approval prompt) override a reported state when the reported label names a
# KNOWN agent. "gtd" names none, so the loop's `claude -p` turns can never move
# this pane's status.
report() { # report <state>
  [ -n "$pane" ] || return 0
  herdr pane report-agent "$pane" \
    --source custom:gtd --agent gtd --state "$1" >/dev/null 2>&1 || true
}

report working
trap 'report blocked; exit 130' INT TERM

# HERDR_PANE_ID is unset for the loop: herdr's Claude Code hook needs it, and
# without it no `claude -p` turn reports a claude SESSION identity for this
# pane. That is load-bearing, not cosmetic — a pane that owns one rejects every
# later state report, so the report below would be dropped.
env -u HERDR_PANE_ID gtd-loop
rc=$?

# Whose turn is it now? `gtd next --sh` is a strictly read-only peek — every
# gtd command is, including `gtd next` (its prompt session id is derived,
# never minted/stored) — only the emitted scripts a driver runs actually
# touch git. A human actor means gtd is waiting on you; anything else means
# the run ended with nothing owed. Assign first, THEN eval — same reason as
# the driver above.
out="$(gtd next --sh 2>/dev/null)" || out=""
eval "${out:-}" 2>/dev/null || true

if [ "$rc" -ne 0 ] || [ -z "${gtd_actor:-}" ] || [ "$gtd_actor" = human ]; then
  report blocked
else
  report idle
fi

exit $rc
```

A few things to know before relying on it:

- **Give `gtd` its own pane.** Run an interactive `claude` (or any agent whose
  herdr integration reports session identity) in the same pane and that pane
  owns a `herdr:claude` session until the process exits; while it does, the
  wrapper's reports are silently ignored and the sidebar stops tracking `gtd`.
- **`blocked` covers the resting `idle` state too** — gtd's own `idle` is a
  human gate (it waits for you to write a steering file), so a finished process
  reads as "your turn", which is what it is.
- The status **persists after the wrapper exits** — that's the point: the
  sidebar keeps showing which worktree is waiting on you. Hand the pane back to
  ordinary detection with
  `herdr pane release-agent "$HERDR_PANE_ID" --source custom:gtd --agent gtd`.
- A non-zero exit (a stall, a refusal, an error) reports `blocked`: herdr has no
  failure state, and those all need a human.
- Ctrl-C reports `blocked` rather than leaving a stale `working`.

Optionally,
`herdr pane report-metadata "$HERDR_PANE_ID" --source custom:gtd-display --token summary=<text>`
sets a value renderable as `$summary` in an Agent sidebar row, if you want more
than the state itself.

## Writing your own driver

Run `gtd install` to print this whole chapter's protocol as a complete,
self-contained briefing — paste it into an agent's context (or read it yourself)
to build a driver without leaving your terminal. The briefing ends by directing
the agent to INTERVIEW you first — which agent CLI runs the turns, under what
permission model, how you want to invoke the loop, what should happen at a human
gate — and to build the driver your answers describe rather than copying the
reference sh. It writes nothing: "install" means installing knowledge into the
calling agent's context, and the briefing it prints is always exactly as current
as the `gtd` that printed it.

The minimal driver below is gtd's own reference driver, not a privileged one —
the engine itself is a supported public surface, and anything below holds for
any driver you write against it. gtd decides and prints; it never touches git
itself. The four commands that change anything — `gtd land`,
`gtd --entry <state>`, `gtd abandon`, and `gtd restore` — perform no git write
when run: each one prints ONE POSIX sh script for YOU to execute
(`src/Emit.ts`'s `combinedScript`) — a leading comment ("gtd emitted this and
did NOT run it — pipe it into `sh` to land the turn"), then the REQUIRED half
verbatim, then, only when there's a presentation-only follow-up, a second
comment ("presentation only — safe to skip") and the OPTIONAL half wrapped in a
subshell whose own non-zero exit is swallowed (reported to stderr as a warning,
never turning a landed turn into a failing one). Printing gtd's output and never
running it is not driving anything; a driver must pipe or execute what gtd
prints — e.g. the capture-then-pipe form the reference driver below uses — never
a bare `gtd land | sh`, which would hand an empty script to a shell on a refusal
instead of stopping first (see the reference driver's own use of `gtd land --sh`
below).

Every script gtd emits — `gtd land`, `gtd --entry <state>`, `gtd abandon`,
`gtd restore`, and the format/validate script `gtd validate` prints — is POSIX
`sh`, portable to `dash`: a driver may run any of them with any POSIX-compliant
shell, not specifically bash. The same convention extends to the workflow's own
`vars.testCommand` (what a `script`-content check state actually executes): it
is expected to be POSIX sh-compatible too, but this is a DOCUMENTED CONVENTION
only — gtd never inspects or validates `testCommand`'s shell dialect itself, it
only renders the value into a script and hands it to whatever shell the driver
invokes that script with.

- **The required half** is everything that decides what lands in git — the
  resting state's own steering-mode `format:`/`validate:` commands, the commit
  itself (`gtd land` and `gtd --entry <state>`), or the ref update and reset
  that undo a process (`gtd abandon`, `gtd restore`) — and, last, a printed line
  naming what just landed (`src/OutcomeScript.ts`'s `gtd_report_*` calls): a
  transition or capture's changed-file rows, or the abandon/restore prose,
  resolved from the repository AFTER the write above it. Its own exit code IS
  the printed script's exit code — skipping it means the turn never lands, and
  you never see what it did.
- **The optional half** is presentation only, wrapped in a subshell whose own
  failure is swallowed (a warning on stderr, nothing more) — skip it (or let it
  fail) and the workflow is still driven correctly either way. No emitter
  currently populates it (it's always the empty string, from every command), so
  `combinedScript`'s optional-half wrapping is dead weight in practice today;
  it's kept as a stable slot in `EmittedScripts`/`combinedScript` for a future
  presentation-only follow-up, not removed as unreachable.

`gtd next --json` carries one more field worth a custom driver's attention:

- **`log`** — the per-worktree loop log path, always present. It's derived from
  the worktree's own git dir, so two worktrees looping concurrently never share
  one file; set `$GTD_LOOP_LOG` to override it verbatim, or `$GIT_DIR` to name
  the git dir directly (both honored the same way every git subprocess already
  honors them — an inherited `$GIT_DIR` moves the log path along with it). gtd
  itself neither creates nor truncates this file — a driver appends subprocess
  output to it and truncates once at the start of a run, exactly like the driver
  above does.

Even a genuine no-op `gtd land` (a clean tree matching no `on` pattern) prints a
PRINT-ONLY script: no git write, just the same `nothing to do at "<state>"` line
the script prints when a driver runs it. Every encoding (plain, `--json`,
`--sh`) carries that same script verbatim in its `script` field — running it is
never optional, whichever encoding a driver reads it from. The script is
self-contained (it carries its own precondition assert and retry helper) and
safe to run standalone, in sequence, or not at all — paste it into a terminal
and it does exactly what it says, printed output included: it detects its own
tty/`NO_COLOR` at RUN time (not at the moment gtd generated it), so the
fancy/plain rendering always matches wherever you actually run it.

A driver has no opening move. It does not need to know whose turn it is before
it starts — `gtd next --json`/`--sh` tells it, and a human's pending edit
arrives as an ordinary `kind: "capture"` beat that the driver lands like any
other. The rule this replaces: never `gtd land` outside a beat you dispatched. A
stray land at a clean `prompt` rest authors an empty attempt on purpose (that IS
the stall bookkeeping), so an unconditional opening land would manufacture a
stall out of a fresh start. The one EXCEPTION is the run's very first beat: land
it before trusting `idle` there too, so a workflow whose initial state declares
its own clean-tree `"C"` pattern still gets a chance to advance on a human's
bare re-invocation, rather than the driver concluding "nothing owed" without
ever giving that edge a turn (see the reference driver's own comment on this).

Exit code carries none of this any more — every command, `next`/`land` included,
exits `0` on success (see [Exit codes](./cli.md#exit-codes)). Whose turn is
next, and whether a landing settles, are both PLAIN FIELDS on
`gtd next --json`/`--sh` and `gtd land --json`/`--sh`: `next`'s own `kind`
(`capture`/`message`/`script`/`prompt`/`stalled`) and `idle`; `land`'s own
`settled` and `idle`. `gtd land --sh` carries `settled`/`idle` alongside the
script itself, so ONE invocation both runs the landing and tells the driver
whether to stop — no second read needed to decide. A no-op at a `script` rest
settles right where it rests (stop immediately, nothing more to read); an
ordinary landing that finishes the whole process instead resolves `idle` on the
FOLLOWING `gtd next` — the reference driver below reads once more only to
DISPLAY that gate's message, never to decide whether to stop. Declaring a `C`
edge on a `script` state is the workflow-side way to make the state advance
instead of settling.

### Drivers other than sh

The protocol above is JSON in (from `gtd next --json` alone), subprocesses out —
sh is one convenient shape, not the only one. A **program** parses
`gtd next --json`, switches on `kind`, and runs `gtd next`'s (plain-text) output
and `gtd land`'s (POSIX sh) output as subprocesses — no sh anywhere in it. A
**human** runs plain `gtd next` (there is no JSON form of it at all), does what
it says, and pastes `gtd land | sh`: plain-text output exists for exactly this,
printing the combined script ready to paste. An **agent** gets `gtd install` as
its instructions — the same protocol, in a form built to be pasted into a
context window rather than read. A **CI job** is the program case with the
`prompt` arm pointed at a headless agent CLI, and
`kind: "message"`/`kind: "stalled"` mapped onto "stop and report".

### A complete minimal driver

This is the whole protocol described above, compressed into a loop small enough
to paste from this page and own outright — save it as `~/.local/bin/gtd-loop`
(`chmod +x`) and it's the ready-to-run driver
[Driving the loop](#driving-the-loop) above points at; swap the `claude` line
for any agent CLI and it keeps working.

This exact fenced block is extracted and executed by
`tests/integration/features/driver-doc.feature` — renaming the heading above or
splitting the block into more than one fence breaks the build.

**Pipe the prompt to the agent CLI on stdin — never pass it as a command-line
argument.** A `prompt` beat's content embeds a full diff, and argv is capped:
roughly 1 MB on macOS, and POSIX guarantees only 4 KB (`ARG_MAX`). Both are
reachable by an ordinary diff, so a driver that passes the prompt as an argument
works in testing and then fails on the first large change, in a way that looks
like an agent error rather than a driver bug. The driver below pipes `$c`/`$out`
into `claude -p` over stdin for exactly this reason.

```bash
#!/usr/bin/env sh
set -eu

beat=1
while :; do
  # One invocation per beat: assign first, THEN eval — command substitution
  # inside eval's own argument would swallow a failed `gtd next` under
  # `set -e` (eval would see only the empty string and abort on some later
  # unset variable with a confusing message). Assigning to `out` first makes
  # this a simple command whose own exit status IS the substitution's, so
  # `set -e` aborts correctly on a genuine failure.
  out="$(gtd next --sh)"
  eval "$out"

  # `gtd_idle` (true iff the initial state, clean tree) is the one shape
  # that means the process is genuinely done — EXCEPT on the run's opening
  # beat: land it anyway, so a workflow whose initial state declares its own
  # clean-tree "C" pattern still gets a chance to fire.
  if [ "$beat" -gt 1 ] && [ "${gtd_idle:-}" = true ]; then
    gtd next
    exit 0
  fi

  case "$gtd_kind" in
    stalled) printf '%s\n' "$gtd_content" >&2; exit 1 ;;
    # you re-ran us resting here: you either edited something or accepted by
    # editing nothing, so land the opening beat either way. Later beats are
    # gates we just produced and you have not read yet — hand off.
    message) [ "$beat" = 1 ] || { gtd next; exit 0; } ;;
    capture) ;; # the human already acted — just land it
    script)
      sh -c "$gtd_content" >>"$gtd_log" 2>&1 || true ;;
    prompt)
      # $gtd_content embeds a full diff, so it goes to the agent over
      # stdin, never as an argv positional — argv is capped (~1 MB on
      # macOS, and POSIX guarantees only 4 KB, ARG_MAX), and a diff crosses
      # that far sooner than you'd expect.
      agent_turn() { printf '%s' "$gtd_content" | claude -p "$1" "$gtd_session_id" \
        ${gtd_model:+--model "$gtd_model"} \
        ${gtd_system:+--system-prompt "$gtd_system"} \
        --dangerously-skip-permissions >>"$gtd_log" 2>&1; }
      if [ "${gtd_session_resume:-}" = true ]
      then agent_turn --resume || agent_turn --session-id
      else agent_turn --session-id || agent_turn --resume
      fi
      n=0
      while [ -n "${gtd_validate:-}" ] && ! fix="$(sh -c "$gtd_validate" 2>&1)"; do
        n=$((n + 1)) && [ "$n" -gt 3 ] && { printf '%s\n' "$fix" >&2; exit 1; }
        # $fix IS the fix prompt, verbatim — piped for the same reason as
        # $gtd_content above. Whether `claude --resume` re-applies the
        # original session's model/system prompt is a harness detail gtd
        # cannot verify from outside, so this passes the identical
        # $gtd_model/$gtd_system on both calls rather than assume it does —
        # otherwise this fix turn might silently fall back to Claude Code's
        # own defaults while the turn that produced the file ran under the
        # workflow's own model and persona.
        printf '%s' "$fix" | claude -p --resume "$gtd_session_id" \
          ${gtd_model:+--model "$gtd_model"} \
          ${gtd_system:+--system-prompt "$gtd_system"} \
          --dangerously-skip-permissions >>"$gtd_log" 2>&1
      done ;;
  esac

  # `gtd land --sh` carries `settled`/`idle` alongside the script itself —
  # one invocation tells us both what to run and whether to stop, with no
  # second read needed to decide either.
  out="$(gtd land --sh)"
  eval "$out"
  printf '%s\n' "$gtd_script" | sh
  if [ "${gtd_settled:-}" = true ]; then
    [ "${gtd_idle:-}" = true ] && gtd next
    exit 0
  fi
  beat=$((beat + 1))
done
```

Line by line it is the protocol described above: `out="$(gtd next --sh)"` then
`eval "$out"` is one invocation per beat — assigning first is what lets `set -e`
abort correctly on a genuine failure, where `eval "$(gtd next --sh)"` would
instead eval the empty string and die later on some unrelated unset variable;
the driver carries no `unset` of its own, since the `--sh` document's own
preamble makes `eval` self-contained. The very first beat lands even when
`gtd_idle` is already true, so a workflow whose initial state declares its own
clean-tree `"C"` pattern still gets a chance to fire before the driver calls it
done. `kind: "stalled"` prints `$gtd_content` (the diagnosis itself) to stderr
and stops — no re-invocation needed, since the beat already fetched it;
`message` halts unless it is the opening beat, which the human's own
re-invocation authored and which therefore lands like any other decision (see
[Driving the loop](#driving-the-loop) above — this is the one place the driver,
not gtd, decides, because "has the human read this gate" is run-scoped knowledge
gtd deliberately does not keep); `capture` lands a human's already-made edit
outright, no display needed; `script` runs `$gtd_content` in the driver;
`prompt` sends it to the agent over stdin with
`$gtd_session_id`/`$gtd_model`/`$gtd_system` mapped onto the agent's session
flags — trying `resume`'s hinted flag first and falling back to the other on
failure, since the session id is derived, not remembered (see
[Driving the loop](#driving-the-loop) above) — and its own `$gtd_validate`
script's output re-prompted verbatim on failure (the driver owns only the retry
cap). Every optional variable (`$gtd_model`, `$gtd_system`, `$gtd_validate`,
`$gtd_session_resume`, `$gtd_idle`, `$gtd_settled`) is read as `${var:-}` or
`${var:+...}` — under `set -u`, the `--sh` document's own `unset` preamble makes
an absent field genuinely unset, not empty, so a bare `$gtd_model` would abort
the driver. Every landed turn is executed — and reported — by the emitted
scripts themselves, via `gtd land --sh`'s own `$gtd_script` field, captured then
piped to `sh`. `$gtd_settled` ends a run that has nothing left to do: a no-op at
a `script` rest settles right where it rests (stop immediately, nothing more to
read), while an ordinary landing that finishes the whole process instead
resolves `$gtd_idle` on the FOLLOWING beat's own `gtd next --sh` read — the
reference driver reads once more (a plain `gtd next`) only to DISPLAY that
gate's own message, the decision to stop already made from `$gtd_settled`/
`$gtd_idle` alone.

This paste passes `$gtd_system` on argv, and POSIX guarantees only 4 KB of argv
(`ARG_MAX`) — real systems are far higher (roughly 1 MB on both macOS and
Linux), and the bundled personas are only a few KB each, so this works
everywhere in practice. A driver shipping much larger system prompts, or
targeting a platform sitting at the POSIX floor, should write the string to a
file and pass that instead: gtd's own contract ends at emitting `gtd_system` as
a string, and how a driver hands that string to its agent CLI — argv, a temp
file, or something else — is the driver's own call, since it alone knows its
platform's argv limit and whether it has a writable temp directory; gtd adds no
flag, no file, and no mechanism of its own for this. (The doc-test below only
proves this paste parses and runs against a `claude` shim — not that the flag is
spelled or placed correctly; that's a `claude --help` check plus one live run,
not something the green suite can catch.)

### The self-validation gate

After an agent turn at a state that declares `file:`+`mode:`, run the script:
either `gtd next --json`'s own embedded `.validate` field (present at every
`prompt` beat that hands over a validatable file), or, standalone,
`gtd validate`'s own plain-text output — both resolve the exact same script from
one shared resolver. This field is now populated even at a FIRST-WRITE beat,
before the steering file exists at all: the script itself carries a leading
`[ -f <file> ] || exit 0` guard rather than gtd checking existence ahead of
time, so a driver's `while [ -n "$gtd_validate" ]` repair loop is armed from the
very first turn at a state, not just the second and later ones. Exit 0 means the
file is well-formed (or genuinely doesn't exist yet) — proceed to `gtd land`. A
non-zero exit usually means the script's own captured output IS a complete,
ready-to-send fix prompt (an instruction plus the findings, see `src/Emit.ts`'s
`failurePromptWrapper`): send it back to the same agent session verbatim, and
cap how many fix attempts you allow yourself — the driver owns that retry count,
not gtd. Landing never TRUSTS that you validated, either: the emitted `land`
script carries the same format/validate commands ahead of its own commit and
fails without committing when they fail, so a malformed file is never captured
whether or not you ran the validate script first.

A non-zero exit can ALSO mean something the fix loop cannot fix: a mode whose
`format:` command breaks its own validator, a config bug gtd detects by
formatting a canonical sample and re-checking it before the real file's own
findings are ever reported. That message is unmistakably different — it says
this is a CONFIGURATION BUG, not the steering file, and tells the agent to stop
and end its turn rather than edit anything. gtd's exit-code contract stays
closed at five numbers (below), so nothing distinguishes the two cases at the
process level — a driver's fix loop is still the CORRECT thing to run in both
cases, it just can never win a contradiction: its 3-attempt cap is what ends
one, not a fix. Reading the message text before re-prompting is what keeps an
agent from thrashing on a document it cannot fix.

### Failure taxonomy and recovery

Several different things can go wrong, and they mean different things — and most
non-zero-looking exits are not a failure at all:

- **`gtd` itself exits 1.** Nothing was attempted — this is a refusal (a guard
  rejected the turn). No script was ever produced.
- **`gtd` itself exits 2.** A usage error — nothing was even attempted, the
  invocation itself was wrong (unknown option/command, bad arity, a scope
  violation).
- **`gtd land` succeeds (exit 0) but doesn't settle.** This is NOT a failure:
  whose turn is next lives in the FOLLOWING `gtd next`'s own `kind` field, not
  in `gtd land`'s exit code (see [Exit codes](./cli.md#exit-codes)) — and
  `gtd land`'s own stdout still carries a script (a print-only note, or an
  ordinary commit) that a driver must still run.
- **An emitted script exits non-zero when YOU run it.** Something may have
  partially happened — e.g. a `gtd_retry`-wrapped git write landed but a later
  step in the same script failed.

Recovery is the same in every case: **ask gtd again** (`gtd next`, then land).
It re-reads the real repository state fresh every time — never a cached plan —
and emits whatever still needs to happen from there. This works because every
emitted script opens by asserting its own precondition
(`[ "$(git rev-parse --verify --quiet HEAD 2>/dev/null)" = <expected> ] || { ...; exit 1; }`
— see `src/Emit.ts`'s `headAssertion`), so a script generated against a
repository state that has since moved refuses loudly instead of corrupting
anything. **Emitted scripts are re-runnable**: this is the single most important
property for a driver's recovery logic. Re-running a script that already fully
applied is a no-op (its git writes are `--allow-empty` commits and idempotent
ref updates), and re-running one that only partially applied resumes correctly,
because the precondition either still holds (nothing landed yet — safe to retry
verbatim) or gtd's next invocation reads the new real state and emits a fresh
script for what remains. A driver never needs its own retry/resume logic beyond
"if the script failed, ask gtd again."

### Prerequisites

- **A POSIX `sh`** (dash, ash, bash's own POSIX mode, etc.) — gtd's own emitted
  scripts (`gtd land`, `gtd --entry <state>`, `gtd abandon`, `gtd restore`) are
  POSIX sh; captured, then piped into it (see
  [Writing your own driver](#writing-your-own-driver) above).
- **`gtd` on `PATH`** — a mode's seeded `validate:` command (the one the
  compiler fills in for the built-in `qa`/`review` formats) is literally the
  string `gtd check <mode> '<file>'`, invoked by NAME from inside an emitted
  script, not by absolute path (see `src/SteeringFormats.ts`'s
  `seededValidateCommand`). This is a deliberate trade: a readable, overridable,
  copy-pasteable command in exchange for depending on shell name resolution at
  the moment the script runs. The sharp edge: if the `gtd` binary you invoked to
  GENERATE the script differs from the `gtd` that resolves on `PATH` when the
  script later RUNS (a locally-built dev binary vs. a globally-installed
  release, say), you can get version skew between the two — the command that
  validates may not be the command that decided. Keep the two in sync (one `gtd`
  on `PATH`, consistently) if you care about that gap.
