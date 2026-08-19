/**
 * The `gtd install` briefing DOCUMENT — string data plus `renderBriefing()`.
 * This module holds no protocol logic and nothing derives behaviour from it;
 * it exists purely so the binary can print, on demand, a complete and
 * self-contained explanation of how to build a gtd driver in any shell
 * or runtime — the self-serve version of README's "Writing your own driver"
 * chapter. `MINIMAL_DRIVER` is pinned equal to that chapter's own fenced
 * bash block by `Install.test.ts`, so the two can never drift.
 */
import { createRequire } from "node:module"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

export const MINIMAL_DRIVER = `#!/usr/bin/env sh
set -eu

# The bundle plans; this executes. Emitted scripts print their own outcomes.
# gtd's own exit code says whose turn is next — 0 nothing owed, 10 an agent
# turn, 20 a human turn — never a failure by itself; only 1 (refusal) or 2
# (usage error) means gtd itself failed. 10/20 are the ORDINARY case now, so
# every gtd call below is captured explicitly — a bare command substitution
# under \`set -e\` would abort the whole driver on either one.
gtd_land() {
  gtd_land_code=0
  gtd_land_script="$(gtd land)" || gtd_land_code=$?
  case "$gtd_land_code" in
    0 | 10 | 20) ;;
    *) return "$gtd_land_code" ;;
  esac
  # Captured, then piped into \`sh\` (gtd's own emitted scripts are POSIX sh —
  # see the "pipe it into \`sh\`" comment they carry) rather than a bare
  # \`gtd land | sh\`: capturing first is what lets this branch on gtd's
  # OWN exit code before running anything at all, so a refusal (1) or usage
  # error (2) returns above without ever handing an empty script to a shell
  # that would silently exit 0 and spin the driver forever.
  printf '%s\\n' "$gtd_land_script" | sh || return $?
  [ "$gtd_land_code" = 0 ] || return 0
  # Nothing is owed, but the rest may or may not have MOVED: a no-op at a
  # \`script\` rest settles right where it rests (re-running it can never make
  # progress, so there is nothing further to read), while an ordinary or
  # squash landing that finishes the whole process moves on to the
  # workflow's own idle gate — read once more and show it before stopping.
  gtd_land_code2=0
  gtd_land_st2="$(gtd status --json)" || gtd_land_code2=$?
  [ "$gtd_land_code2" = 0 ] && { gtd next || true; }
  exit 0
}

beat=1
while :; do
  code=0
  st="$(gtd status --json)" || code=$?
  # Idle (the initial state, clean tree) is the one shape that means the
  # process is genuinely done — EXCEPT on the run's opening beat: land it
  # anyway, so the workflow's own idle \`on:\` edge gets one chance to fire if
  # the human's re-invocation while resting there is itself a decision (a
  # clean-tree "C" pattern declared on that very state).
  if [ "$code" = 0 ] && [ "$beat" -gt 1 ]; then
    gtd next || true
    exit 0
  fi
  case "$code" in
    0 | 10 | 20) ;;
    *) exit "$code" ;;
  esac
  kind="$(printf '%s' "$st" | jq -r .kind)"
  log="$(printf '%s' "$st" | jq -r .log)"
  case "$kind" in
    stalled) gtd next >&2 || true; exit 1 ;;
    # you re-ran us resting here: you either edited something or accepted by
    # editing nothing, so land the opening beat either way. Later beats are
    # gates we just produced and you have not read yet — hand off.
    message) [ "$beat" = 1 ] || { gtd next || true; exit 0; } ;;
    capture) ;; # the human already acted — just land it
    script) c="$(gtd next)" || true; sh -c "$c" >>"$log" 2>&1 || true ;;
    prompt)
      c="$(gtd next)" || true
      sid="$(printf '%s' "$st" | jq -r '.session.id // empty')"
      model="$(printf '%s' "$st" | jq -r '.model // empty')"
      # $c embeds a full diff, so it goes to the agent over stdin, never as
      # an argv positional — argv is capped (~1 MB on macOS, and POSIX
      # guarantees only 4 KB, ARG_MAX), and a diff crosses that far sooner
      # than you'd expect.
      agent_turn() { printf '%s' "$c" | claude -p "$1" "$sid" \\
        \${model:+--model "$model"} --dangerously-skip-permissions \\
        >>"$log" 2>&1; }
      if [ "$(printf '%s' "$st" | jq -r '.session.resume // false')" = true ]
      then agent_turn --resume || agent_turn --session-id
      else agent_turn --session-id || agent_turn --resume
      fi
      v="$(printf '%s' "$st" | jq -r '.validate // empty')"
      n=0
      while [ -n "$v" ] && ! out="$(sh -c "$v" 2>&1)"; do
        n=$((n + 1)) && [ "$n" -gt 3 ] && { printf '%s\\n' "$out" >&2; exit 1; }
        # $out IS the fix prompt, verbatim — piped for the same reason as $c
        printf '%s' "$out" | claude -p --resume "$sid" \\
          --dangerously-skip-permissions >>"$log" 2>&1
      done ;;
  esac
  gtd_land || exit 1
  beat=$((beat + 1))
done`

const HEADER = (): string =>
  `gtd ${GTD_VERSION} — driver protocol\n` +
  `\n` +
  `gtd decides and prints; the driver executes. gtd never runs git, never runs\n` +
  `your agent, and never runs a check script. The one subprocess gtd ever spawns\n` +
  `itself is a steering mode's own format:/validate: command, during a\n` +
  `land-capture guard.\n`

const BEAT_PROTOCOL = `
## The beat protocol

Two reads and one write, repeated: ask -> act -> land.

  gtd status --json   which kind is next — a pure read; poll it, peek it, no writes
  gtd next            what to run/show, in plain text — the SAME rest gtd status just read
  gtd land            how to record what happened — run the script it prints

Every beat that acts, lands. Every beat that rests, exits.

Both reads are pure PEEKS — every field \`gtd status --json\` reports
(\`.session.id\`/\`.session.resume\` included) is DERIVED from history, never
stored, so looking is free: nothing distinguishes a peek from a dispatch, and
calling either one twice in a row is always safe. There is no separate
claiming form, and \`gtd next\`'s plain-text output is always the SAME text as
\`gtd status --json\`'s own \`content\` field for that same rest.

The \`kind\` field selects what to do:

- \`stalled\` — print \`gtd next\`'s output (a diagnosis) to stderr and exit
  non-zero. Terminal: another dispatch would just repeat the same fruitless
  turn.
- \`message\` — print \`gtd next\`'s output and exit 0. This is a human gate.
  EXCEPT on the run's opening beat: the human invoked you while resting
  there, so land it instead of printing. Some gates route a \`"C"\`
  (clean-tree) pattern onward, making "change nothing" a real decision that
  looks identical to a gate nobody has read yet; landing an opening beat at a
  gate without one is a benign no-op, and it prints on the next beat.
- \`capture\` — a human gate the human already acted on (the tree is dirty).
  Land it immediately, no display needed.
- \`script\` — run \`sh -c "$(gtd next)"\`, appending its output to the
  \`log\` field, and ignore its exit code — the outcome lives in the tree, not
  in the exit code.
- \`prompt\` — send \`gtd next\`'s output to your agent CLI, using the
  accompanying \`session\`/\`model\`/\`validate\` fields off \`gtd status --json\`
  (see below).
`

const JSON_FIELD_REFERENCE = `
## JSON field reference

gtd has exactly one JSON payload: \`gtd status --json\`. There is no version
field — the field set itself is the contract, and a breaking change to it is
a major release. Every field below is always present unless marked "when
set" — omitted, never \`null\`.

- Always: \`kind\` (\`capture\`|\`message\`|\`script\`|\`prompt\`|\`stalled\`),
  \`content\` (the SAME text \`gtd next\` prints, plain, for this same rest),
  \`log\`, \`state\`, \`actor\`, \`changes\` (which declared \`on\` pattern, if any,
  each pending change matches), \`next\` (the first declared \`on\` edge that
  would fire right now — \`{action?, pattern, target}\` — or \`null\` on no
  match)
- Only at \`kind: "prompt"\` (the DISPATCH BLOCK — absent at every other kind,
  a \`stalled\` beat included, by construction): \`session\` (\`{id, resume}\`,
  both DERIVED from history — a hash of the resting state's memory scope —
  never stored, so a plain peek is exactly as safe to call as a dispatch would
  be) and, when the state declares a validatable steering file, \`validate\`
  (the script that formats then validates it — the same script \`gtd
  validate\` prints as plain text for this same rest, embedded here)
- When set: \`model\`, \`memory\`, \`label\`, \`file\`, \`mode\`, \`edges\` — plain
  facts about the resting state, present at every kind
- When a cost has been recorded (a prior \`gtd land --cost=<n>\`): \`cost\`,
  \`costByModel\`

### The error envelope

stdout is either the complete artifact or byte-empty — never a partial write
followed by an error. On any failure — a usage error, a refusal, a defect —
stdout stays byte-empty: \`{"state":"error","prompt":"<message>"}\` rides
**stderr** instead, followed by a single \`gtd: \` line — exit 1 for a refusal
or defect, exit 2 for a usage error (nothing was even attempted). This is
true of every command, not only \`gtd status\` — an invocation that carries
(or misuses) \`--json\` still gets this envelope on its own failure. A driver
piping stdout into \`jq\` on a failed run reads nothing; read stderr or the
exit code to learn why.

### Exit codes (\`gtd next\`, \`gtd status\`, \`gtd land\` — every other command
is plain: 0 on success, 1 (refusal) or 2 (usage error) on failure, with no
owner-signal meaning attached)

| code      | meaning                                                              |
| --------- | --------------------------------------------------------------------- |
| 0         | nothing owed — idle (the resolved/post-land rest is the workflow's initial state, tree clean), a no-op at a \`script\` rest, or the initial-state collapse |
| 10        | the next turn needs an AGENT (the resolved/post-land rest is \`script\`/\`prompt\`) |
| 20        | the next turn needs a HUMAN (\`capture\`/\`message\`/\`stalled\`)      |
| 1         | refusal — nothing was emitted                                        |
| 2         | usage error — nothing was even attempted                             |
| 130 / 143 | gtd itself died by SIGINT / SIGTERM                                   |

None of 0/10/20 is a failure by itself — only 1/2 mean gtd itself failed.
Capture \`gtd land\`'s output and check its OWN exit code before running
anything (see obligation 8 below) — never a bare \`gtd land | sh\`, which
would hand an empty script to \`sh\` on a refusal instead of stopping first.
`

const DRIVER_OBLIGATIONS = `
## Driver obligations, in order

1. Read the resolved rest's \`kind\` off \`gtd status --json\` once per
   iteration — its own exit code (0/10/20) says whose turn is next, never a
   failure by itself; only 1/2 means gtd itself failed. There is no opening
   move: a human's pending edit arrives as a \`kind: "capture"\` beat, which
   you land immediately without executing anything. EXCEPT: don't trust a
   \`0\` on the run's very first iteration — land that beat first, so a
   workflow whose initial state declares its own clean-tree \`"C"\` pattern
   still gets one chance to advance before you conclude nothing is owed.
2. Read the content to run/show off \`gtd next\` (plain text) — the SAME
   rest \`gtd status --json\` just read; no \`jq\` needed against it. Every gtd
   invocation, including this one, captures its own exit code explicitly:
   10/20 are the ORDINARY case now, and a bare command substitution under
   \`set -e\` aborts on either. At a \`prompt\` beat this content embeds a
   full diff, so hand it to the agent CLI over STDIN, never as a
   command-line argument — argv is capped (roughly 1 MB on macOS, and POSIX
   guarantees only 4 KB, \`ARG_MAX\`), both reachable by an ordinary diff, and
   an argv-passing driver fails on the first large one in a way that looks
   like an agent error rather than a driver bug.
3. A \`kind: "stalled"\` beat halts the driver with a non-zero exit; a
   \`kind: "message"\` beat prints \`content\` and exits 0, unless it is the
   run's opening beat — land that one, since the human's re-invocation while
   resting there is itself their decision.
4. Run scripts with their output appended to \`.log\` (\`gtd status --json\`'s
   own \`log\` field) — gtd never creates or truncates that file itself;
   truncate it once per run. \`$GTD_LOOP_LOG\` overrides its path.
5. Map \`.session.id\`/\`.session.resume\` onto the agent CLI's own session
   flags — try \`resume\`'s hinted flag first and fall back to the other on
   failure (\`resume\` is a hint, not a contract: nothing is stored, so a
   crashed prior turn or an expired agent session recovers by itself).
6. After a \`prompt\` beat, run the document's own \`.validate\` script (when
   present) and re-prompt its output verbatim on failure — the DRIVER owns
   the retry cap, not gtd.
7. Land only a beat you acted on (\`capture\`/\`script\`/\`prompt\`) — a stray
   \`gtd land\` at a clean \`prompt\` rest authors an empty attempt on purpose
   (that IS the stall bookkeeping), so don't land beats you didn't dispatch.
8. Run \`gtd land\`, capturing its OWN output into a variable, THEN piping
   that variable into \`sh\` (gtd's own emitted scripts are POSIX sh —
   see the "pipe it into \`sh\`" comment they carry) — never a bare
   \`gtd land | sh\` with nothing captured first: a refusal (1) or usage
   error (2) prints nothing, and piping empty input straight into \`sh\`
   would exit 0 and spin the driver forever instead of stopping on gtd's own
   code.
9. \`gtd land\` exiting 0 means there is nothing left to do — run its script
   first, then stop; exiting 10 or 20 continues the loop. That stop has two
   shapes with no field to tell them apart any more: a no-op at a \`script\`
   rest settles right where it rests (stop immediately, nothing more to
   read), while an ordinary or squash landing that finishes the process
   moves on to the workflow's own idle gate (read once more and show it).
   **The migration hazard is an inversion, not a renumbering** — a driver
   that only checks for a strict 0 to mean "keep going" halts on the very
   first turn.
`

const RECOVERY = `
## Recovery

gtd exiting 2 means nothing was even attempted — a usage error; exiting 1
means a refusal — nothing was emitted either. 10/20 are NOT a failure: they
say whose turn is next, and \`gtd land\`'s stdout still carries a script to
run. An emitted script exiting non-zero when YOU run it means something MAY
have partially happened. All of these recover the same way: re-invoke gtd
(\`gtd status --json\`, \`gtd next\`, then \`gtd land\`). It re-reads the real
repository state fresh every time — never a cached plan — and emits whatever
still needs to happen from there. This works because every emitted script
asserts its own HEAD precondition, so a script generated against a repository
state that has since moved refuses loudly instead of corrupting anything.
Scripts are re-runnable and assert their own HEAD precondition — a driver
needs no retry logic beyond "ask gtd again".
`

const referenceImplementation = (): string =>
  `
## Building the user's driver: interview first, then adapt

The obligations above are the contract; the sh block below is one WORKED
EXAMPLE of it. Do not copy it blindly, and do not guess the user's setup —
INTERVIEW them, then build a driver shaped by their answers. Ask (offering
the default when they have no preference):

1. **Which agent should run the turns?** Whatever coding-agent CLI they
   already use (default: \`claude\`). Map \`.session.id\`/\`.session.resume\`
   onto THAT agent's continuation mechanism (obligation 5); an agent with no
   session concept just ignores them — memory is an optimization, every
   prompt is self-contained.
2. **Under which permission model?** Fully autonomous turns (e.g.
   \`--dangerously-skip-permissions\`), a sandbox, or the agent's default
   prompting — their risk tolerance, their call. Also whether the workflow's
   own \`.model\` hints should be honored (default: yes).
3. **How do they want to invoke it?** A command on PATH (default:
   \`~/.local/bin/gtd-loop\`), a project task-runner entry, a CI job step —
   or no artifact at all: YOU drive the beats yourself, following the
   obligations directly. Pick the runtime to match: bash, their language of
   choice, anything that parses JSON and spawns subprocesses.
4. **What should happen at the boundaries?** Where the log goes (obligation
   4), and whether halting at a human gate should do anything richer than
   print — desktop notification, terminal-multiplexer status, editor focus —
   which belongs in their wrapper, never in gtd.

Then build it, and verify safely before the first real drive:
\`gtd status --json\`/\`gtd next\` are both pure reads — parse them, check your
kind dispatch against the table above, call them as often as you like.
Nothing happens until you run an emitted script.

The reference rendering in sh (requires \`jq\` for \`gtd status --json\`'s
fields — \`gtd next\` needs none, since it's plain text; the \`claude\` lines
are what answers 1–2 replace):

\`\`\`bash
${MINIMAL_DRIVER}
\`\`\`
`

const PREREQUISITES = `
## Prerequisites and portability

- \`jq\` — to pull \`gtd status --json\`'s fields (\`.kind\`, \`.log\`,
  \`.session.id\`, \`.session.resume\`, \`.model\`, \`.validate\`) back out of its
  JSON. \`gtd next\`/\`gtd land\` print plain text, so nothing else needs it.
- A POSIX \`sh\` (dash, ash, bash's own POSIX mode, etc.) — gtd's own emitted
  scripts (\`gtd land\`, \`gtd --entry <state>\`, \`gtd abandon\`,
  \`gtd restore\`) are POSIX sh; captured, then piped into it (see obligation
  8 above).
- \`gtd\` on \`PATH\` — a seeded mode \`validate:\` command is literally the
  string \`gtd check <mode> '<file>'\`, resolved by NAME at script-run time.
  Keep one \`gtd\` on \`PATH\`, consistently.

Any runtime works: the contract is JSON in (from \`gtd status --json\` alone),
subprocesses out.
`

export const renderBriefing = (): string =>
  HEADER() +
  BEAT_PROTOCOL +
  JSON_FIELD_REFERENCE +
  DRIVER_OBLIGATIONS +
  RECOVERY +
  referenceImplementation() +
  PREREQUISITES
