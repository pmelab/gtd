/**
 * The `gtd install` briefing DOCUMENT — string data plus `renderBriefing()`.
 * This module holds no protocol logic and nothing derives behaviour from it;
 * it exists purely so the binary can print, on demand, a complete and
 * self-contained explanation of how to build a gtd loop driver in any shell
 * or runtime — the self-serve version of README's "Writing your own driver"
 * chapter. `MINIMAL_DRIVER` is pinned equal to that chapter's own fenced
 * bash block by `Install.test.ts`, so the two can never drift.
 */
import { createRequire } from "node:module"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

export const MINIMAL_DRIVER = `#!/usr/bin/env bash
set -euo pipefail

# The bundle plans; this executes. Emitted scripts print their own outcomes.
# Exit 3 means SETTLED — nothing owed — so this exits the whole driver at 0.
gtd_land() {
  local json code=0
  json="$(gtd land --json)" || code=$?
  [ "$code" = 0 ] || [ "$code" = 3 ] || return "$code"
  bash -c "$(jq -r '.required // empty' <<<"$json")" || return $?
  bash -c "$(jq -r '.optional // empty' <<<"$json")" ||
    echo "warn: presentation follow-up failed — continuing" >&2
  [ "$code" = 3 ] && exit 0
  return 0
}

while :; do
  next="$(gtd next --json)" || exit 1
  kind="$(jq -r .kind <<<"$next")"
  log="$(jq -r .log <<<"$next")"
  case "$kind" in
    stalled) jq -r .content <<<"$next" >&2; exit 1 ;;
    message) jq -r .content <<<"$next"; exit 0 ;;
    capture) ;; # the human already acted — just land it
    script) bash -c "$(jq -r .content <<<"$next")" >>"$log" 2>&1 || true ;;
    prompt)
      sid="$(jq -r '.session.id // empty' <<<"$next")"
      c="$(jq -r .content <<<"$next")" model="$(jq -r '.model // empty' <<<"$next")"
      agent_turn() { claude -p "$c" "$1" "$sid" \${model:+--model "$model"} \\
        --dangerously-skip-permissions >>"$log" 2>&1; }
      if [ "$(jq -r '.session.resume // false' <<<"$next")" = true ]
      then agent_turn --resume || agent_turn --session-id
      else agent_turn --session-id || agent_turn --resume
      fi
      v="$(jq -r '.validate // empty' <<<"$next")" n=0
      while [ -n "$v" ] && ! out="$(bash -c "$v" 2>&1)"; do
        n=$((n + 1)) && [ "$n" -gt 3 ] && { printf '%s\\n' "$out" >&2; exit 1; }
        claude -p "$out" --resume "$sid" --dangerously-skip-permissions \\
          >>"$log" 2>&1 # $out IS the fix prompt, verbatim
      done ;;
  esac
  gtd_land || exit 1
done`

const HEADER = (): string =>
  `gtd ${GTD_VERSION} — driver protocol\n` +
  `\n` +
  `gtd decides and prints; the driver executes. gtd never runs git, never runs\n` +
  `your agent, and never runs a check script. The one subprocess gtd ever spawns\n` +
  `itself is a steering mode's own format:/validate: command, during a\n` +
  `step-capture guard.\n`

const BEAT_PROTOCOL = `
## The beat protocol

Two commands, one repeated beat: ask -> act -> land.

  gtd next --json   what now - a pure read; poll it, peek it, no writes
  gtd land --json   how to record what happened - run the script it emits

Every beat that acts, lands. Every beat that rests, exits.

\`gtd next --json\` is a read-only PEEK — every field (\`.session.id\`/
\`.session.resume\` included) is DERIVED from history, never stored, so looking
is free: nothing distinguishes a peek from a dispatch, and calling it twice in
a row is always safe. There is no separate claiming form.

The \`kind\` field selects what to do:

- \`stalled\` — print \`.content\` (a diagnosis) to stderr and exit non-zero.
  Terminal: another dispatch would just repeat the same fruitless turn.
- \`message\` — print \`.content\` and exit 0. This is a human gate.
- \`capture\` — a human gate the human already acted on (the tree is dirty).
  Land it immediately, no display needed.
- \`script\` — run \`bash -c .content\`, appending its output to \`.log\`, and
  ignore its exit code — the outcome lives in the tree, not in the exit code.
- \`prompt\` — send \`.content\` to your agent CLI, using the embedded
  \`.session\`/\`.model\`/\`.validate\` fields (see below).
`

const JSON_FIELD_REFERENCE = `
## JSON field reference

Every field below is always present unless marked "when set".

### \`gtd next --json\` — the beat document

- Always: \`kind\` (\`capture\`|\`message\`|\`script\`|\`prompt\`|\`stalled\`),
  \`content\`, \`log\`, \`state\`, \`actor\`
- When set: \`model\`, \`memory\`, \`label\`, \`file\`, \`mode\`, \`edges\` — plain
  facts about the resting state, present at every kind
- Only at \`kind: "prompt"\` (the DISPATCH BLOCK — absent at every other kind,
  a \`stalled\` beat included, by construction): \`session\` (\`{id, resume}\`,
  both DERIVED from history — a hash of the resting state's memory scope —
  never stored, so a plain peek is exactly as safe to call as a dispatch would
  be) and, when the state declares a validatable steering file, \`validate\`
  (the same script \`gtd validate --json\`'s \`.script\` emits, embedded)

### \`gtd land --json\` (also \`--entry\`)

\`state\`, \`subject\` (\`null\` on a no-op), \`script\` (the combined form —
\`required\` verbatim, \`optional\` wrapped non-fatally, so a
\`jq -r .script | bash\` driver needs one \`bash\` call, not two), \`required\`,
\`optional\`, \`settled\`; \`cost\`/\`model\` when recorded. \`--entry\` omits
\`settled\` — read it as \`.settled // false\`.

### \`gtd abandon\`/\`gtd restore --json\`

\`required\`, \`optional\` (always \`""\`).

### \`gtd validate --json\`

\`state\`, \`script\` (\`""\` means nothing to validate); \`file\`/\`mode\` when the
resolved rest declares them. On a non-zero run the script's own output IS the
fix prompt, verbatim.

### The error envelope

\`{"state":"error","prompt":"<message>"}\` on stdout, plus a single \`gtd: \`
line on stderr, exit 1 — this covers usage errors and defects too.

### Exit codes (\`gtd land\` only — every other command is plain 0/1)

| code | meaning                                                              |
| ---- | --------------------------------------------------------------------- |
| 0    | a script was emitted (capture, turn, attempt, squash), or a benign no-op at a clean \`message\` rest |
| 3    | SETTLED — nothing owed: a no-op at a \`script\` rest, or the initial-state collapse. stdout still carries a script (a print-only note, or the collapse's real retain+rewind) — run it |
| 1    | refusal or usage error — nothing was emitted                          |

With \`set -o pipefail\`, \`gtd land | bash\` propagates gtd's own exit code
through the pipe.
`

const DRIVER_OBLIGATIONS = `
## Driver obligations, in order

1. Read exactly one \`gtd next --json\` beat document per iteration. There is
   no opening move: a human's pending edit arrives as a \`kind: "capture"\`
   beat, which you land immediately without executing anything.
2. A \`kind: "stalled"\` beat halts the driver with a non-zero exit; a
   \`kind: "message"\` beat prints \`content\` and exits 0.
3. Run scripts with their output appended to \`.log\` — gtd never creates or
   truncates that file itself; truncate it once per run. \`$GTD_LOOP_LOG\`
   overrides its path.
4. Map \`.session.id\`/\`.session.resume\` onto the agent CLI's own session
   flags — try \`resume\`'s hinted flag first and fall back to the other on
   failure (\`resume\` is a hint, not a contract: nothing is stored, so a
   crashed prior turn or an expired agent session recovers by itself).
5. After a \`prompt\` beat, run the document's own \`.validate\` script (when
   present) and re-prompt its output verbatim on failure — the DRIVER owns
   the retry cap, not gtd.
6. Land only a beat you acted on (\`capture\`/\`script\`/\`prompt\`) — a stray
   \`gtd land\` at a clean \`prompt\` rest authors an empty attempt on purpose
   (that IS the stall bookkeeping), so don't land beats you didn't dispatch.
7. Run \`gtd land --json\`, then execute its \`required\` (always) and
   \`optional\` (presentation only — its failure is a warning, not a halt).
8. Exit 3 (SETTLED) means there is nothing left to do — run the script first,
   then stop; exit 0 continues the loop.
`

const RECOVERY = `
## Recovery

gtd exiting 1 means nothing was attempted — a refusal or a usage error. Exit
3 is NOT a failure: it means SETTLED (nothing owed), and stdout still carries
a script to run. An emitted script exiting non-zero when YOU run it means
something MAY have partially happened. All three recover the same way:
re-invoke gtd. It re-reads the real repository state fresh every time, and
every emitted script asserts its own HEAD precondition, so a script generated
against a repository state that has since moved refuses loudly instead of
corrupting anything. Scripts are re-runnable and assert their own HEAD
precondition — a driver needs no retry logic beyond "ask gtd again".
`

const referenceImplementation = (): string =>
  `
## The reference implementation

This is the whole protocol, and nothing else — swap the \`claude\` line for
any agent CLI and it keeps working:

\`\`\`bash
${MINIMAL_DRIVER}
\`\`\`
`

const PREREQUISITES = `
## Prerequisites and portability

- \`jq\` — to pull \`required\`/\`optional\`/the rest of the JSON fields above
  back out of gtd's \`--json\` output.
- \`gtd\` on \`PATH\` — a seeded mode \`validate:\` command is literally the
  string \`gtd check <mode> '<file>'\`, resolved by NAME at script-run time.
  Keep one \`gtd\` on \`PATH\`, consistently.

Any runtime works: the contract is JSON in, subprocesses out.
`

export const renderBriefing = (): string =>
  HEADER() +
  BEAT_PROTOCOL +
  JSON_FIELD_REFERENCE +
  DRIVER_OBLIGATIONS +
  RECOVERY +
  referenceImplementation() +
  PREREQUISITES
