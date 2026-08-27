// `MINIMAL_DRIVER` is pinned equal to https://github.com/pmelab/gtd/blob/main/docs/driver.md's "A complete minimal driver" fenced bash block by `Install.test.ts`, so the two can never drift.
import { createRequire } from "node:module"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

export const MINIMAL_DRIVER = `#!/usr/bin/env sh
set -eu

beat=1
while :; do
  # One value per invocation: \`gtd next --json=<path>\` is a pure read (peek
  # or dispatch, indistinguishable, always safe to call again), so nothing is
  # lost by reading \`kind\`/\`idle\` as two separate calls rather than one
  # combined document.
  kind="$(gtd next --json=kind)"
  idle="$(gtd next --json=idle)"

  # \`idle\` (true iff the initial state, clean tree) is the one shape that
  # means the process is genuinely done — EXCEPT on the run's opening beat:
  # land it anyway, so a workflow whose initial state declares its own
  # clean-tree "C" pattern still gets a chance to fire.
  if [ "$beat" -gt 1 ] && [ "\${idle:-}" = true ]; then
    gtd next
    exit 0
  fi

  case "$kind" in
    stalled)
      gtd next --json=content >&2
      exit 1 ;;
    # you re-ran us resting here: you either edited something or accepted by
    # editing nothing, so land the opening beat either way. Later beats are
    # gates we just produced and you have not read yet — hand off.
    message) [ "$beat" = 1 ] || { gtd next; exit 0; } ;;
    capture) ;; # the human already acted — just land it
    script)
      # A \`script\` rest's plain output is prose, not pipeable into \`sh\` — the
      # raw script comes from \`--json=content\` instead.
      content="$(gtd next --json=content)"
      log="$(gtd next --json=log)"
      sh -c "$content" >>"$log" 2>&1 || true ;;
    prompt)
      session_id="$(gtd next --json=session.id)"
      resume="$(gtd next --json=session.resume)"
      model="$(gtd next --json=model)"
      system="$(gtd next --json=system)"
      validate="$(gtd next --json=validate)"
      log="$(gtd next --json=log)"
      # The prompt embeds a full diff, so it goes to the agent over stdin,
      # never as an argv positional — argv is capped (~1 MB on macOS, and
      # POSIX guarantees only 4 KB, ARG_MAX), and a diff crosses that far
      # sooner than you'd expect. Piping plain \`gtd next\` (not
      # --json=content) means the diff is rendered once, for this input,
      # rather than twice.
      agent_turn() { gtd next | claude -p "$1" "$session_id" \\
        \${model:+--model "$model"} \\
        \${system:+--system-prompt "$system"} \\
        --dangerously-skip-permissions >>"$log" 2>&1; }
      if [ "\${resume:-}" = true ]
      then agent_turn --resume || agent_turn --session-id
      else agent_turn --session-id || agent_turn --resume
      fi
      n=0
      while [ -n "\${validate:-}" ] && ! fix="$(sh -c "$validate" 2>&1)"; do
        n=$((n + 1)) && [ "$n" -gt 3 ] && { printf '%s\\n' "$fix" >&2; exit 1; }
        # $fix IS the fix prompt, verbatim — piped for the same reason the
        # agent's own turn above is. Whether \`claude --resume\` re-applies the
        # original session's model/system prompt is a harness detail gtd
        # cannot verify from outside, so this passes the identical
        # $model/$system on both calls rather than assume it does —
        # otherwise this fix turn might silently fall back to Claude Code's
        # own defaults while the turn that produced the file ran under the
        # workflow's own model and persona.
        printf '%s' "$fix" | claude -p --resume "$session_id" \\
          \${model:+--model "$model"} \\
          \${system:+--system-prompt "$system"} \\
          --dangerously-skip-permissions >>"$log" 2>&1
      done ;;
  esac

  # Read every value the landing needs BEFORE piping the script to \`sh\`:
  # \`gtd land\` itself never mutates — it only plans and prints — so
  # \`settled\`/\`idle\`/\`script\` planned against the same untouched tree all
  # agree, whatever order they're read in, as long as all three are read
  # before the script runs and changes the tree out from under them.
  settled="$(gtd land --json=settled)"
  idle="$(gtd land --json=idle)"
  gtd land --json=script | sh
  if [ "\${settled:-}" = true ]; then
    [ "\${idle:-}" = true ] && gtd next
    exit 0
  fi
  beat=$((beat + 1))
done`

export const EDIT_COMMAND = `#!/usr/bin/env sh
set -eu
cd "$(git rev-parse --show-toplevel)"
f="$(gtd next --json=file)"
f="\${f:-.gtd/TODO.md}"
mkdir -p "$(dirname "$f")"
exec "\${EDITOR:-vi}" "$f"`

export const REVIEW_COMMAND = `#!/usr/bin/env sh
set -eu
GTD_BUILD=~/.local/bin/gtd-build
if [ -z "\${1:-}" ]; then
  echo "usage: gtd-review <commitish>" >&2
  exit 2
fi
cd "$(git rev-parse --show-toplevel)"
script="$(gtd --entry review-gate.check --var reviewBase="$1")"
sh -c "$script"
exec "$GTD_BUILD"`

export const FIX_COMMAND = `#!/usr/bin/env sh
set -eu
GTD_BUILD=~/.local/bin/gtd-build
cd "$(git rev-parse --show-toplevel)"
script="$(gtd --entry fix-precheck)"
sh -c "$script"
exec "$GTD_BUILD"`

const HEADER = (): string =>
  `gtd ${GTD_VERSION} — driver protocol\n` +
  `\n` +
  `gtd decides and prints; the driver executes. gtd never runs git, never runs\n` +
  `your agent, never runs a check script, and never runs a steering mode's own\n` +
  `format:/validate: command either — that pair is text in the script gtd next\n` +
  `--json's validate field (or gtd validate) prints, for the driver to run\n` +
  `itself ahead of gtd land.\n`

const BEAT_PROTOCOL = `
## The beat protocol

Two reads and one write, repeated: ask -> act -> land.

  gtd next --json=<path>   which kind is next, and any other field, one pure
                            scalar read per value (kind, content, idle,
                            session.id, model, validate, log, ...)
  gtd next                   what to run/show, in plain text — the SAME rest
                            the --json=<path> reads above are peeking at
  gtd land --json=<path>   how to record what happened, and whether anything
                            is still owed (script to run, settled to check)

Every beat that acts, lands. Every beat that rests, exits.

Every \`gtd next --json=<path>\`/\`gtd land --json=<path>\` read is a pure PEEK —
every field it reports (\`session.id\`/\`session.resume\` included) is DERIVED
from history, never stored, so looking is free: nothing distinguishes a peek
from a dispatch, and calling either one twice in a row is always safe. There
is no separate claiming form.

\`gtd next\` has one structured encoding, \`--json\`: bare \`--json\` prints the
whole document, \`--json=<path>\` (a dotted key path, e.g. \`kind\`, \`content\`,
\`session.id\`) prints just that one value — a scalar raw and unquoted, a
boolean as \`true\`/\`false\`, a list one JSON entry per line. An absent
optional field prints nothing and exits 0; an unknown path is a usage error
(exit 2). An AI driver reads \`kind\`/\`session.id\` and the rest straight off
\`--json=<path>\`, one call per value, without parsing anything — no JSON
library, no \`jq\`; this briefing's own reference driver reads every field this
way. Plain \`gtd next\` (no flag) is NOT a parsing surface: \`content\` is the
bare step in every encoding; plain adds the self-validation instruction at a
validatable \`prompt\` rest, and adds a status-summary header at every kind
EXCEPT \`prompt\` (those bytes are the agent's own input, so no header is
prefixed there). A driver that wants \`content\` programmatically reads it off
\`--json=content\`, never by scraping plain text.

The \`kind\` field (\`--json=kind\`) selects what to do:

- \`stalled\` — print \`--json=content\` (the diagnosis, already in hand) to
  stderr and exit non-zero. Terminal: another dispatch would just repeat the
  same fruitless turn.
- \`message\` — print plain \`gtd next\`'s output (the richer status header,
  not bare \`content\`) and exit 0. This is a human gate. EXCEPT on the run's
  opening beat: the human invoked you while resting there, so land it
  instead of printing. Some gates route a \`"C"\` (clean-tree) pattern
  onward, making "change nothing" a real decision that looks identical to a
  gate nobody has read yet; landing an opening beat at a gate without one is
  a benign no-op, and it prints on the next beat.
- \`capture\` — a human gate the human already acted on (the tree is dirty).
  Land it immediately, no display needed.
- \`script\` — run \`--json=content\` with \`sh -c\`, appending its output to
  \`--json=log\`, and ignore its exit code — the outcome lives in the tree,
  not in the exit code.
- \`prompt\` — send plain \`gtd next\`'s own output to your agent CLI over
  stdin (it's the bare content at this kind, so no separate \`--json=content\`
  read is needed), using the accompanying \`session.id\`/\`session.resume\`/
  \`model\`/\`validate\` fields, each its own \`--json=<path>\` read (see
  below).
`

const JSON_FIELD_REFERENCE = `
## Field reference

\`gtd next\` and \`gtd land\` each carry one field set, read through \`--json\`
(bare for the whole document, \`--json=<path>\` for one value) — this driver's
own beats read fields one at a time via \`--json=<path>\` throughout (see the
beat protocol above). There is no version field — the field set itself is the
contract, and a breaking change to it is a major release. Every field below
is always present unless marked "when set" — omitted under bare \`--json\`
(never \`null\`); under \`--json=<path>\` an absent field prints nothing and
exits 0, so read it in a shell variable and guard on emptiness
(\`\${x:-}\`/\`\${x:+...}\`) rather than assuming it is always populated.

\`gtd next\` fields — Always: \`kind\` (\`capture\`|\`message\`|\`script\`|\`prompt\`|
\`stalled\`), \`content\` (the bare step in every encoding — plain \`gtd next\`
adds the self-validation instruction at a validatable \`prompt\` rest, and a
status-summary header at every OTHER kind; \`content\` itself never carries
either), \`idle\` (\`true\` iff the resolved rest is the workflow's initial
state with a clean tree), \`log\`, \`state\`, \`actor\`, \`changes\` (which
declared \`on\` pattern, if any, each pending change matches), \`next\` (the
first declared \`on\` edge that would fire right now — \`{action?, pattern,
target}\` — or \`null\` on no match). Only at \`kind: "prompt"\` (the DISPATCH
BLOCK — absent at every other kind, a \`stalled\` beat included, by
construction): \`session.id\`/\`session.resume\` — both DERIVED from history,
never stored, so a plain peek is exactly as safe to call as a dispatch would
be — and, when the state declares a validatable steering file, \`validate\`
(the script that formats then validates it). When set: \`model\`, \`memory\`,
\`label\`, \`file\`, \`mode\`, \`edges\`. When a cost has been recorded (a prior
\`gtd land --cost=<n>\`): \`cost\`, \`costByModel\`.

\`gtd land\` fields, in fixed order: \`script\` (the POSIX sh to run), \`settled\`
(true for a no-op at a \`script\` rest — stop immediately, nothing more to
read), \`idle\` (true iff the state landing rests at is the workflow's initial
state), \`state\`, \`subject\`, \`cost\`, \`model\` (the last three \`null\`, never
omitted, for a genuine no-op).

### The error envelope

stdout is either the complete artifact or byte-empty — never a partial write
followed by an error. On any failure — a usage error, a refusal, a defect —
stdout stays byte-empty: \`{"state":"error","prompt":"<message>"}\` rides
**stderr** instead, followed by a single \`gtd: \` line — exit 1 for a refusal
or defect, exit 2 for a usage error (nothing was even attempted). This is
true of every command, not only \`gtd next\` — an invocation that carries (or
misuses) \`--json\` still gets this envelope on its own failure. A driver
reading stdout on a failed run reads nothing; read stderr or the exit code
to learn why.
`

const DRIVER_OBLIGATIONS = `
## Driver obligations, in order

1. Read the resolved rest's \`kind\` off \`gtd next --json=kind\` once per
   iteration. Exit code is uniformly \`0\` on success now — it never says
   whose turn is next; only \`1\`/\`2\` means gtd itself failed. There is no
   opening move: a human's pending edit arrives as a \`kind: "capture"\` beat,
   which you land immediately without executing anything. EXCEPT: don't
   trust \`idle\` on the run's very first iteration — land that beat first, so
   a workflow whose initial state declares its own clean-tree \`"C"\` pattern
   still gets one chance to advance before you conclude nothing is owed.
2. Read the content to run/show off \`--json=content\` — never off plain
   \`gtd next\`, which is not a parsing surface (it wraps \`content\` in a
   status-summary header at every kind but \`prompt\`; see the beat protocol
   above). At a \`prompt\` beat, though, pipe plain \`gtd next\`'s own output to
   the agent instead of reading \`--json=content\` separately — it IS the bare
   content at that kind, so a second read would only render the same diff
   twice. Whichever form you read, hand it to the agent CLI over STDIN, never
   as a command-line argument — argv is capped (roughly 1 MB on macOS, and
   POSIX guarantees only 4 KB, \`ARG_MAX\`), both reachable by an ordinary
   diff, and an argv-passing driver fails on the first large one in a way
   that looks like an agent error rather than a driver bug.
3. A \`kind: "stalled"\` beat prints \`--json=content\` to stderr and halts with
   a non-zero exit; a \`kind: "message"\` beat prints plain \`gtd next\`'s
   output and exits 0, unless it is the run's opening beat — land that one,
   since the human's re-invocation while resting there is itself their
   decision.
4. Run scripts with their output appended to \`--json=log\` — gtd never
   creates or truncates that file itself; truncate it once per run.
   \`$GTD_LOOP_LOG\` overrides its path.
5. Map \`--json=session.id\`/\`--json=session.resume\` onto the agent CLI's own
   session flags — try \`resume\`'s hinted flag first and fall back to the
   other on failure (\`resume\` is a hint, not a contract: nothing is stored,
   so a crashed prior turn or an expired agent session recovers by itself).
6. After a \`prompt\` beat, run the same beat's own \`--json=validate\` script
   (when set) and re-prompt its output verbatim on failure — the DRIVER
   owns the retry cap, not gtd.
7. Land only a beat you acted on (\`capture\`/\`script\`/\`prompt\`) — a stray
   \`gtd land\` at a clean \`prompt\` rest authors an empty attempt on purpose
   (that IS the stall bookkeeping), so don't land beats you didn't dispatch.
8. Read \`--json=settled\`/\`--json=idle\` from \`gtd land\` BEFORE running the
   script — \`gtd land\` never mutates, it only plans and prints, so these
   reads and the \`--json=script\` read that follows all agree, planned
   against the same untouched tree. Pipe \`--json=script\`'s own output into
   \`sh\` — never a bare \`gtd land | sh\`, which would hand an empty script to
   \`sh\` on a refusal instead of stopping first.
9. Check the settled/idle values read in step 8 — no second read needed to
   decide. \`settled = true\` means stop right there (a no-op at a \`script\`
   rest settles in place; nothing more to read); otherwise keep looping, and
   the run finishes when a LATER \`gtd next --json=idle\` reports \`true\`
   (read once more with plain \`gtd next\` only to show that gate's message,
   the decision to stop already made). Exit code carries none of this any
   more — every command exits \`0\` on success uniformly.
`

const RECOVERY = `
## Recovery

gtd exiting 2 means nothing was even attempted — a usage error; exiting 1
means a refusal — nothing was emitted either. An emitted script exiting
non-zero when YOU run it means something MAY have partially happened. Both
recover the same way: re-invoke gtd (\`gtd next --json=kind\`, \`gtd next\`,
then \`gtd land --json=<path>\`). It re-reads the real repository state fresh
every time — never a cached plan — and emits whatever still needs to happen
from there. This works because every emitted script asserts its own HEAD
precondition, so a script generated against a repository state that has
since moved refuses loudly instead of corrupting anything. Scripts are
re-runnable and assert their own HEAD precondition — a driver needs no retry
logic beyond "ask gtd again".
`

const commandSuite = (): string =>
  `
## Building the user's command suite: interview first, then adapt

The obligations above are the contract; the four command bodies below are one
WORKED EXAMPLE of it. Do not copy them blindly, and do not guess the user's
setup — INVESTIGATE first, then INTERVIEW, then build a suite shaped by both.
Hold ONE conversation, not four: the setup steps below come first, because a
repo that is not set up yet cannot be driven, and the suite-shape questions
follow in the same numbered list.

1. **Investigate the repository and ask the user what they want before
   driving anything.** Look at what is already there (a \`.gtd/\` directory,
   existing config, the project's own README/docs) and ask the user what
   they're trying to accomplish with gtd here — don't assume a fresh
   install or silently start a process on their behalf.
2. **Run \`gtd init\`, and treat an "a gtd config already exists" refusal as
   success.** Do not hand-roll your own check for \`.gtdrc\`/\`.gtdrc.json\`/
   etc. first — gtd accepts six different config filenames at the
   repository root, and only gtd itself knows how to recognize all of
   them; asking it via \`gtd init\` and reading its answer is the only
   check that can't drift from gtd's own rule.
3. **Commit the config before the first drive.** \`gtd init\` leaves its
   written file uncommitted on purpose (its own message says so) — an
   uncommitted config is a pending change, so starting a process without
   committing it first turns the config into the very first thing the
   process plans against. Commit it, THEN start driving.
4. **Which agent should run the turns?** Probe \`PATH\` for the known
   coding-agent CLIs — \`claude\`, \`codex\`, \`gemini\`, \`cursor-agent\`,
   \`aider\`, \`opencode\`, \`amp\` — show the user which are actually
   installed, and ask which one to drive with (default: \`claude\`). Accept
   a name that was not on the list; the probe is a convenience, not a
   restriction. The chosen CLI's own flags then replace the \`claude\` lines
   in the reference body below — its session flags (obligation 5) and its
   permission model (question 5).
5. **Under which permission model, and should the workflow's model hints be
   honored at all?** Fully autonomous turns (e.g.
   \`--dangerously-skip-permissions\`), a sandbox, or the agent's default
   prompting — their risk tolerance, their call. Also ask whether the
   workflow's own \`model\` hints (resolved in question 6 below) should be
   honored (default: yes) — answering no means dropping \`--model\` entirely
   from every prompt line and writing no model exports, so every turn runs
   on the chosen CLI's own default tier.
6. **If model hints are honored, resolve them to real model identifiers.**
   The bundled workflow ships \`plannerModel: smart\` and \`coderModel: base\`.
   **Those are opaque hints, not model names** — gtd never interprets them,
   and passing \`--model smart\` to a real CLI fails on the first prompt
   beat. Derive the chosen CLI's own available models at install time — its
   \`--help\`, its docs, its own config — never a hardcoded table (a vendor
   renames a model and a baked-in list goes stale the day it ships). **When
   the heavier/cheaper mapping is not obvious, ask**: list the CLI's models
   and let the user pick one per tier — the heavier tier for
   \`plannerModel\` (triage, design, review), the cheaper tier for
   \`coderModel\` (build, fix). Write the resolved names as
   \`GTD_PLANNERMODEL\`/\`GTD_CODERMODEL\` exports at the top of \`gtd-build\`,
   wrapped in \`# gtd-install: model exports\` / \`# gtd-install: end\`
   markers — NOT into \`.gtdrc\`. They stay per machine and are never
   committed, so one person's model choice binds nobody else on the repo.
   Two consequences follow, both worth stating to the user: \`gtd-review\`
   and \`gtd-fix\` inherit these exports only because they \`exec\`
   \`gtd-build\` — anything that drives beats without going through
   \`gtd-build\` sees the raw \`smart\`/\`base\` hints and fails; and \`GTD_*\` is
   the highest-precedence config layer, so these exports silently win over
   a \`plannerModel\`/\`coderModel\` a teammate later commits to \`.gtdrc\`.
7. **What should happen at the boundaries?** Where the log goes (obligation
   4), and whether halting at a human gate should do anything richer than
   print — desktop notification, terminal-multiplexer status, editor focus —
   which belongs in their wrapper, never in gtd.
8. **How do they want to invoke it?** A command on PATH (default:
   \`~/.local/bin/gtd-build\`), a project task-runner entry, a CI job step —
   or no artifact at all: YOU drive the beats yourself, following the
   obligations directly. Pick the runtime to match: bash, their language of
   choice, anything that reads \`--json=<path>\` and spawns subprocesses.
9. **Where should the suite live, which editor should \`gtd-edit\` spawn, and
   does anything need renaming?** Suggest \`~/.local/bin\` for all four —
   \`gtd-build\`, \`gtd-edit\`, \`gtd-review\`, \`gtd-fix\` — and \`$EDITOR\` (never
   a hardcoded editor) for the one that opens files. The interview can
   rename any of the four; whatever name is chosen for \`gtd-build\` is the
   RESOLVED path baked into \`GTD_BUILD\` in the other two bodies below —
   never the literal string \`gtd-build\`.

Then build it, and verify safely before the first real drive:
\`gtd next --json=<path>\`/\`gtd next\` are both pure reads — read/parse them,
check your kind dispatch against the table above, call them as often as you
like. Nothing happens until you run an emitted script.

The reference rendering in sh (no \`jq\`, no JSON parser at all — each
\`--json=<path>\` call prints its one value directly). Two of the four bodies
below share one convention: \`GTD_BUILD\` is set once, at the top, to the
suite's resolved \`gtd-build\` path.

### \`gtd-build\` — the driver loop

The \`claude\` lines are what interview answers 4 and 6 replace. Default path:
\`~/.local/bin/gtd-build\`.

\`\`\`bash
${MINIMAL_DRIVER}
\`\`\`

### \`gtd-edit\` — open the steering file the process is resting at

\`gtd next --json=file\` already reports the file for every state that
declares one — the edit command needs no new engine surface, just a read and
an editor spawn. \`file\` is an OPTIONAL field: \`--json=file\` prints nothing
(not the string \`null\`) at a state that declares no \`file:\`, so read it into
a shell variable and fall back explicitly — \`f="$(gtd next --json=file)"\`
then \`f="\${f:-.gtd/TODO.md}"\`, never assume the read populated anything. This
is also the general rule for every optional field \`--json=<path>\` exposes:
an absent field is silence, not the string \`null\` a \`jq .field\` recipe would
print on the same input — code that treats empty output as "field genuinely
absent" is correct, code that expects a literal \`null\` string is not.

This is also how a human starts a process at all: at the initial \`idle\`
state the resting file IS \`.gtd/TODO.md\`, so on a clean repository the edit
command opens the empty scratch file, and whatever the human writes there is
the first sketch the whole process gets planned from. The same command does
the same thing at every rest, whether or not a state declares a \`file:\`.

The edit command stops when the editor exits — it never drives the loop. It
opens a file and returns; the human runs \`gtd-build\` themselves when they
are ready. Default path: \`~/.local/bin/gtd-edit\`.

\`\`\`bash
${EDIT_COMMAND}
\`\`\`

### \`gtd-review <commitish>\` — start a review round and drive it

Runs \`gtd --entry review-gate.check --var reviewBase=<commitish>\`, captured
by command substitution — never a pipe: a pipeline reports only its LAST
command's exit status, so \`gtd --entry ... | sh\` under \`set -e\` would sail
past a refusal and \`exec\` a loop over a process that was never started. It
runs the captured script, then \`exec\`s the suite's RESOLVED \`gtd-build\`
path — never the literal string \`gtd-build\`. This is one invocation that
carries the review all the way to its next human gate, not just a starter:
\`gtd-review\` on a RED baseline hands off to \`gtd-build\`, which halts at the
blocked gate and prints it, rather than starting the review. Refuses with
\`usage: gtd-review <commitish>\` on stderr and exit \`2\` when the commitish is
missing — nothing was even attempted. Default path: \`~/.local/bin/gtd-review\`.

\`\`\`bash
${REVIEW_COMMAND}
\`\`\`

### \`gtd-fix\` — enter the fix process and drive it

Runs \`gtd --entry fix-precheck\`, captured the same way, then \`exec\`s the
suite's RESOLVED \`gtd-build\` path. \`gtd-fix\` on a GREEN suite is a no-op
straight back to \`idle\` — the exec'd \`gtd-build\` exits immediately on it.
Default path: \`~/.local/bin/gtd-fix\`.

\`\`\`bash
${FIX_COMMAND}
\`\`\`
${REINSTALL}`

const REINSTALL = `
## Re-installing: detect and adapt, don't blindly overwrite

A second install on a machine that already has a suite is not a fresh
install — read each of the four suite paths before writing anything
(\`gtd-build\`, \`gtd-edit\`, \`gtd-review\`, \`gtd-fix\`), and branch per path:

- Absent — install it, as in a fresh install.
- Present and content-equal to what this gtd version would emit — say so,
  change nothing, and skip that command's interview questions entirely.
- Present and different — show the difference, name the likely cause (a gtd
  upgrade, or the user's own edit), and ask before overwriting. Never
  silently replace a file the user may have customised.
- Unreadable, or present as a directory instead of a file — report it and
  ask about it, the same as a differing file. Never overwritten.

Drift is detected by comparing CONTENT, never by parsing a version out of
the installed file — an installed command carries no version marker to
parse.

\`gtd-build\` needs one exemption before that comparison: the region between
\`# gtd-install: model exports\` and \`# gtd-install: end\` gets stripped from
the installed file first. A \`gtd-build\` differing only inside those
markers is unchanged, and re-asks nothing — the resolved model names are
per machine, so without this exemption every single re-install would
report drift on the one command everybody has.

This check scopes to exactly the four suite paths above. \`gtd-loop\` is
outside it entirely — never read, never diffed, never touched by it in any
way — an existing \`gtd-loop\` survives untouched beside the new
\`gtd-build\`, and cleaning it up is the human's own call.
`

const EDITOR_INTEGRATION = `
## Editor integration: offer it, don't bury it

\`gtd lsp\` runs a language server, started by \`gtd lsp\` itself, speaking LSP
over \`stdio\`, applying to files under \`.gtd/\`. That is the whole integration
contract, identical for every editor — this briefing names no specific editor
and carries no per-editor config recipe.

Find the user's editor from their OWN shell configuration, never a guess:
check \`$EDITOR\`/\`$VISUAL\` first, then look for an alias or export in their
shell rc files (\`.zshrc\`, \`.bashrc\`, \`.config/fish/config.fish\`). Ask the
user outright when that turns up nothing or turns up more than one. When the
shell configuration names no editor and the user names none either, say
nothing and move on — don't pitch editor integration to somebody with no
editor to integrate.

Once an editor is identified, look ITS OWN LSP configuration format up
yourself — there is no bundled recipe for it. If it is LSP-capable, offer to
wire \`gtd lsp\` up with a brief explanation (three or four lines, not a copy
of \`docs/setup.md\`): live diagnostics on \`.gtd/\` steering files, an outline
of what is left to review, click-to-check review hunks, pick-an-option
actions on open questions, and a \`gtd.openSteeringFile\` command that jumps
to the current state's file. Two facts belong in that offer because both
bite on a fresh repo: \`gtd lsp\` never creates \`.gtd/\`, so
\`gtd.openSteeringFile\` may point at a path that does not exist yet before
the first sketch; and \`gtd lsp\` needs no repository root — it is one of the
commands that skips the root guard.

On yes, edit the editor's own config file yourself — never print a snippet
and walk away. Integration works without the human touching anything. Three
guards apply to that write, because it lands outside the repository in a
file the user shares across every project:

- **Ask first, per editor, naming the exact file** about to change. Silence
  is not consent for a machine-wide config.
- **Merge, never overwrite.** Read the existing config, add only the gtd
  language-server entry, and leave every other key byte-identical.
- **Skip and report when the entry is already present** — a second install
  must not append a duplicate server registration. A malformed existing
  config (unparseable JSON, a TOML syntax error) is a stop-and-report, not a
  rewrite: name the file that could not be parsed and leave it untouched.
`

const PREREQUISITES = `
## Prerequisites and portability

- A POSIX \`sh\` (dash, ash, bash's own POSIX mode, etc.) — gtd's own emitted
  scripts (\`gtd land --json=script\`, \`gtd --entry <state>\`, \`gtd abandon\`,
  \`gtd restore\`) are POSIX sh; captured, then piped into it (see obligation
  8 above). Reading \`gtd next --json=<path>\`/\`gtd land --json=<path>\`'s own
  output needs nothing beyond the same POSIX \`sh\` — no \`eval\`, no parser.
- \`gtd\` on \`PATH\` — a seeded mode \`validate:\` command is literally the
  string \`gtd check <mode> '<file>'\`, resolved by NAME at script-run time.
  Keep one \`gtd\` on \`PATH\`, consistently.

Any runtime works: the contract is \`--json\`/\`--json=<path>\` in, subprocesses
out.
`

export const renderBriefing = (): string =>
  HEADER() +
  BEAT_PROTOCOL +
  JSON_FIELD_REFERENCE +
  DRIVER_OBLIGATIONS +
  RECOVERY +
  commandSuite() +
  EDITOR_INTEGRATION +
  PREREQUISITES
