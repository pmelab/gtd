// `MINIMAL_DRIVER` is pinned equal to README's "Writing your own driver" fenced bash block by `Install.test.ts`, so the two can never drift.
import { createRequire } from "node:module"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

export const MINIMAL_DRIVER = `#!/usr/bin/env sh
set -eu

beat=1
while :; do
  # One invocation per beat: assign first, THEN eval — command substitution
  # inside eval's own argument would swallow a failed \`gtd next\` under
  # \`set -e\` (eval would see only the empty string and abort on some later
  # unset variable with a confusing message). Assigning to \`out\` first makes
  # this a simple command whose own exit status IS the substitution's, so
  # \`set -e\` aborts correctly on a genuine failure.
  out="$(gtd next --sh)"
  eval "$out"

  # \`gtd_idle\` (true iff the initial state, clean tree) is the one shape
  # that means the process is genuinely done — EXCEPT on the run's opening
  # beat: land it anyway, so a workflow whose initial state declares its own
  # clean-tree "C" pattern still gets a chance to fire.
  if [ "$beat" -gt 1 ] && [ "\${gtd_idle:-}" = true ]; then
    gtd next
    exit 0
  fi

  case "$gtd_kind" in
    stalled) printf '%s\\n' "$gtd_content" >&2; exit 1 ;;
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
      agent_turn() { printf '%s' "$gtd_content" | claude -p "$1" "$gtd_session_id" \\
        \${gtd_model:+--model "$gtd_model"} \\
        \${gtd_system:+--system-prompt "$gtd_system"} \\
        --dangerously-skip-permissions >>"$gtd_log" 2>&1; }
      if [ "\${gtd_session_resume:-}" = true ]
      then agent_turn --resume || agent_turn --session-id
      else agent_turn --session-id || agent_turn --resume
      fi
      n=0
      while [ -n "\${gtd_validate:-}" ] && ! fix="$(sh -c "$gtd_validate" 2>&1)"; do
        n=$((n + 1)) && [ "$n" -gt 3 ] && { printf '%s\\n' "$fix" >&2; exit 1; }
        # $fix IS the fix prompt, verbatim — piped for the same reason as
        # $gtd_content above. Whether \`claude --resume\` re-applies the
        # original session's model/system prompt is a harness detail gtd
        # cannot verify from outside, so this passes the identical
        # $gtd_model/$gtd_system on both calls rather than assume it does —
        # otherwise this fix turn might silently fall back to Claude Code's
        # own defaults while the turn that produced the file ran under the
        # workflow's own model and persona.
        printf '%s' "$fix" | claude -p --resume "$gtd_session_id" \\
          \${gtd_model:+--model "$gtd_model"} \\
          \${gtd_system:+--system-prompt "$gtd_system"} \\
          --dangerously-skip-permissions >>"$gtd_log" 2>&1
      done ;;
  esac

  # \`gtd land --sh\` carries \`settled\`/\`idle\` alongside the script itself —
  # one invocation tells us both what to run and whether to stop, with no
  # second read needed to decide either.
  out="$(gtd land --sh)"
  eval "$out"
  printf '%s\\n' "$gtd_script" | sh
  if [ "\${gtd_settled:-}" = true ]; then
    [ "\${gtd_idle:-}" = true ] && gtd next
    exit 0
  fi
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

  gtd next --sh   which kind is next, as gtd_-prefixed POSIX shell
                  assignments (eval it) — a pure read; poll it, peek it, no writes
  gtd next          what to run/show, in plain text — the SAME rest the --sh read just fetched
  gtd land --sh   how to record what happened, and whether anything is
                  still owed (gtd_script to run, gtd_settled to check) — eval it, run gtd_script

Every beat that acts, lands. Every beat that rests, exits.

Both reads are pure PEEKS — every field \`gtd next --sh\`/\`--json\` reports
(\`gtd_session_id\`/\`gtd_session_resume\` included) is DERIVED from history,
never stored, so looking is free: nothing distinguishes a peek from a
dispatch, and calling either one twice in a row is always safe. There is no
separate claiming form.

\`gtd next\` has \`--json\`/\`--sh\` encodings, mutually exclusive, reading the
SAME field set whether you call \`gtd next --json\` or \`gtd next --sh\` —
\`--json\`'s keys, or \`--sh\`'s \`gtd_\`-prefixed shell assignments. An AI
driver reads \`gtd_kind\`/\`gtd_session_id\` and the rest straight off \`--sh\`
without parsing anything — no JSON library, no \`jq\`; this briefing's own
reference driver uses \`--sh\` throughout. Plain
\`gtd next\` (no flag) is NOT a parsing surface: \`content\` is the bare step
in every encoding; plain adds the self-validation instruction at a
validatable \`prompt\` rest, and adds a status-summary header at every kind
EXCEPT \`prompt\` (those bytes are the agent's own input, so no header is
prefixed there). A driver that wants \`content\` programmatically reads it
off \`--json\`/\`--sh\` (\`gtd_content\` under \`--sh\`), never by scraping plain
text.

The \`kind\` field (\`gtd_kind\` under \`--sh\`) selects what to do:

- \`stalled\` — print \`gtd_content\` (the diagnosis, already in hand) to
  stderr and exit non-zero. Terminal: another dispatch would just repeat the
  same fruitless turn.
- \`message\` — print plain \`gtd next\`'s output (the richer status header,
  not bare \`gtd_content\`) and exit 0. This is a human gate. EXCEPT on the
  run's opening beat: the human invoked you while resting there, so land it
  instead of printing. Some gates route a \`"C"\` (clean-tree) pattern
  onward, making "change nothing" a real decision that looks identical to a
  gate nobody has read yet; landing an opening beat at a gate without one is
  a benign no-op, and it prints on the next beat.
- \`capture\` — a human gate the human already acted on (the tree is dirty).
  Land it immediately, no display needed.
- \`script\` — run \`gtd_content\` with \`sh -c\`, appending its output to
  \`gtd_log\`, and ignore its exit code — the outcome lives in the tree, not
  in the exit code.
- \`prompt\` — send \`gtd_content\` to your agent CLI over stdin, using the
  accompanying \`gtd_session_id\`/\`gtd_model\`/\`gtd_validate\` fields off the
  SAME \`--sh\` read (see below).
`

const JSON_FIELD_REFERENCE = `
## Field reference

\`gtd next\` and \`gtd land\` each carry one field set, in two encodings:
\`--json\`'s keys, or \`--sh\`'s \`gtd_\`-prefixed shell assignments — this
driver's own beats poll \`--sh\` throughout (see the beat protocol above).
There is no version field — the field set itself is the contract, and a
breaking change to it is a major release. Every field below is always
present unless marked "when set" — omitted under \`--json\` (never \`null\`),
genuinely unset under \`--sh\` (its own \`unset\` preamble, so read an optional
one as \`\${gtd_model:-}\` or \`\${gtd_model:+...}\`, never bare).

\`gtd next\` fields — Always: \`kind\` (\`capture\`|\`message\`|\`script\`|\`prompt\`|
\`stalled\`), \`content\` (the bare step in every encoding — plain \`gtd next\`
adds the self-validation instruction at a validatable \`prompt\` rest, and a
status-summary header at every OTHER kind; \`content\` itself never carries
either), \`idle\` (\`true\` iff the resolved rest is the workflow's initial
state with a clean tree — under \`--sh\`, present only when \`true\`), \`log\`,
\`state\`, \`actor\`, \`changes\` (which declared \`on\` pattern, if any, each
pending change matches), \`next\` (the first declared \`on\` edge that would
fire right now — \`{action?, pattern, target}\` — or \`null\` on no match).
Only at \`kind: "prompt"\` (the DISPATCH BLOCK — absent at every other kind,
a \`stalled\` beat included, by construction): \`session\` (\`{id, resume}\` —
\`gtd_session_id\`/\`gtd_session_resume\` under \`--sh\` — both DERIVED from
history, never stored, so a plain peek is exactly as safe to call as a
dispatch would be) and, when the state declares a validatable steering
file, \`validate\` (the script that formats then validates it). When set:
\`model\`, \`memory\`, \`label\`, \`file\`, \`mode\`, \`edges\`. When a cost has been
recorded (a prior \`gtd land --cost=<n>\`): \`cost\`, \`costByModel\`.

\`gtd land\` fields, in fixed order: \`script\` (the POSIX sh to run —
\`gtd_script\` under \`--sh\`), \`settled\` (true for either terminal shape: a
no-op at a \`script\` rest, or a decision that collapses back to the initial
state retaining nothing — stop immediately, nothing more to read), \`idle\`
(true iff the state landing rests at is the workflow's initial state),
\`state\`, \`subject\`, \`cost\`, \`model\` (the last three \`null\`, never
omitted, for a genuine no-op).

### The error envelope

stdout is either the complete artifact or byte-empty — never a partial write
followed by an error. On any failure — a usage error, a refusal, a defect —
stdout stays byte-empty: \`{"state":"error","prompt":"<message>"}\` rides
**stderr** instead, followed by a single \`gtd: \` line — exit 1 for a refusal
or defect, exit 2 for a usage error (nothing was even attempted). This is
true of every command, not only \`gtd next\` — an invocation that carries (or
misuses) \`--json\` still gets this envelope on its own failure. A driver
piping stdout into a JSON parser on a failed run reads nothing; read stderr
or the exit code to learn why.
`

const DRIVER_OBLIGATIONS = `
## Driver obligations, in order

1. Read the resolved rest's \`kind\` off \`gtd next --sh\` once per iteration
   (assign its output to a variable, THEN \`eval\` that variable — never
   \`eval "$(gtd next --sh)"\` directly, since a failed \`gtd next\` would then
   eval the empty string and die later on some unrelated unset variable
   instead of aborting cleanly). Exit code is uniformly \`0\` on success now —
   it never says whose turn is next; only \`1\`/\`2\` means gtd itself failed.
   There is no opening move: a human's pending edit arrives as a
   \`kind: "capture"\` beat, which you land immediately without executing
   anything. EXCEPT: don't trust \`gtd_idle\` on the run's very first
   iteration — land that beat first, so a workflow whose initial state
   declares its own clean-tree \`"C"\` pattern still gets one chance to
   advance before you conclude nothing is owed.
2. Read the content to run/show off the SAME \`--sh\` read's \`gtd_content\` —
   never off plain \`gtd next\`, which is not a parsing surface (it wraps
   \`content\` in a status-summary header at every kind but \`prompt\`; see the
   beat protocol above). At a \`prompt\` beat this content embeds a full
   diff, so hand it to the agent CLI over STDIN, never as a command-line
   argument — argv is capped (roughly 1 MB on macOS, and POSIX guarantees
   only 4 KB, \`ARG_MAX\`), both reachable by an ordinary diff, and an
   argv-passing driver fails on the first large one in a way that looks
   like an agent error rather than a driver bug.
3. A \`kind: "stalled"\` beat prints \`gtd_content\` (already in hand — no
   re-invocation needed) to stderr and halts with a non-zero exit; a
   \`kind: "message"\` beat prints plain \`gtd next\`'s output and exits 0,
   unless it is the run's opening beat — land that one, since the human's
   re-invocation while resting there is itself their decision.
4. Run scripts with their output appended to \`gtd_log\` — gtd never creates
   or truncates that file itself; truncate it once per run. \`$GTD_LOOP_LOG\`
   overrides its path.
5. Map \`gtd_session_id\`/\`gtd_session_resume\` onto the agent CLI's own
   session flags — try \`resume\`'s hinted flag first and fall back to the
   other on failure (\`resume\` is a hint, not a contract: nothing is stored,
   so a crashed prior turn or an expired agent session recovers by itself).
6. After a \`prompt\` beat, run the same read's own \`gtd_validate\` script
   (when set) and re-prompt its output verbatim on failure — the DRIVER
   owns the retry cap, not gtd.
7. Land only a beat you acted on (\`capture\`/\`script\`/\`prompt\`) — a stray
   \`gtd land\` at a clean \`prompt\` rest authors an empty attempt on purpose
   (that IS the stall bookkeeping), so don't land beats you didn't dispatch.
8. Run \`gtd land --sh\` (assign, then \`eval\`, exactly like obligation 1) and
   pipe its own \`gtd_script\` into \`sh\` — never a bare \`gtd land | sh\`,
   which would hand an empty script to \`sh\` on a refusal instead of
   stopping first.
9. Check the SAME \`gtd land --sh\` read's \`gtd_settled\`/\`gtd_idle\` fields —
   no second read needed to decide. \`gtd_settled = true\` means stop right
   there (a no-op at a \`script\` rest settles in place; nothing more to
   read); otherwise keep looping, and the run finishes when a LATER
   \`gtd next --sh\` reports \`gtd_idle = true\` (read once more with plain
   \`gtd next\` only to show that gate's message, the decision to stop
   already made). Exit code carries none of this any more — every command
   exits \`0\` on success uniformly.
`

const RECOVERY = `
## Recovery

gtd exiting 2 means nothing was even attempted — a usage error; exiting 1
means a refusal — nothing was emitted either. An emitted script exiting
non-zero when YOU run it means something MAY have partially happened. Both
recover the same way: re-invoke gtd (\`gtd next --sh\`, \`gtd next\`, then
\`gtd land --sh\`). It re-reads the real repository state fresh every time —
never a cached plan — and emits whatever still needs to happen from there.
This works because every emitted script asserts its own HEAD precondition,
so a script generated against a repository state that has since moved
refuses loudly instead of corrupting anything. Scripts are re-runnable and
assert their own HEAD precondition — a driver needs no retry logic beyond
"ask gtd again".
`

const referenceImplementation = (): string =>
  `
## Building the user's driver: interview first, then adapt

The obligations above are the contract; the sh block below is one WORKED
EXAMPLE of it. Do not copy it blindly, and do not guess the user's setup —
INTERVIEW them, then build a driver shaped by their answers. Ask (offering
the default when they have no preference):

1. **Which agent should run the turns?** Whatever coding-agent CLI they
   already use (default: \`claude\`). Map \`gtd_session_id\`/
   \`gtd_session_resume\` onto THAT agent's continuation mechanism
   (obligation 5); an agent with no session concept just ignores them —
   memory is an optimization, every prompt is self-contained.
2. **Under which permission model?** Fully autonomous turns (e.g.
   \`--dangerously-skip-permissions\`), a sandbox, or the agent's default
   prompting — their risk tolerance, their call. Also whether the workflow's
   own \`gtd_model\` hints should be honored (default: yes).
3. **How do they want to invoke it?** A command on PATH (default:
   \`~/.local/bin/gtd-loop\`), a project task-runner entry, a CI job step —
   or no artifact at all: YOU drive the beats yourself, following the
   obligations directly. Pick the runtime to match: bash, their language of
   choice, anything that parses \`--json\`/\`--sh\` and spawns subprocesses.
4. **What should happen at the boundaries?** Where the log goes (obligation
   4), and whether halting at a human gate should do anything richer than
   print — desktop notification, terminal-multiplexer status, editor focus —
   which belongs in their wrapper, never in gtd.

Then build it, and verify safely before the first real drive:
\`gtd next --sh\`/\`gtd next\` are both pure reads — eval/parse them, check
your kind dispatch against the table above, call them as often as you like.
Nothing happens until you run an emitted script.

The reference rendering in sh (no \`jq\`, no JSON parser at all — \`--sh\`'s
own \`gtd_\`-prefixed shell assignments are eval'd directly; the \`claude\`
lines are what answers 1–2 replace):

\`\`\`bash
${MINIMAL_DRIVER}
\`\`\`
`

const PREREQUISITES = `
## Prerequisites and portability

- A POSIX \`sh\` (dash, ash, bash's own POSIX mode, etc.) — gtd's own emitted
  scripts (\`gtd land\`, \`gtd --entry <state>\`, \`gtd abandon\`,
  \`gtd restore\`) are POSIX sh; captured, then piped into it (see obligation
  8 above). \`eval\`ing \`gtd next --sh\`/\`gtd land --sh\`'s own output needs
  nothing beyond the same POSIX \`sh\`.
- \`gtd\` on \`PATH\` — a seeded mode \`validate:\` command is literally the
  string \`gtd check <mode> '<file>'\`, resolved by NAME at script-run time.
  Keep one \`gtd\` on \`PATH\`, consistently.

Any runtime works: the contract is \`--json\`/\`--sh\` in, subprocesses out.
`

export const renderBriefing = (): string =>
  HEADER() +
  BEAT_PROTOCOL +
  JSON_FIELD_REFERENCE +
  DRIVER_OBLIGATIONS +
  RECOVERY +
  referenceImplementation() +
  PREREQUISITES
