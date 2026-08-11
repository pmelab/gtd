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
gtd_do() {
  local json
  json="$(gtd "$@" --json)" || return 1
  bash -c "$(jq -r '.required // empty' <<<"$json")" || return $?
  bash -c "$(jq -r '.optional // empty' <<<"$json")" ||
    echo "warn: presentation follow-up failed — continuing" >&2
  GTD_STEP_JSON="$json"
}

gtd_do step human --if-resting # capture your pending edit, or resume

while :; do
  next="$(gtd next --json --dispatch)" || exit 1
  kind="$(jq -r .kind <<<"$next")"
  log="$(jq -r .log <<<"$next")"
  jq -e '.stalled // false' <<<"$next" >/dev/null &&
    { echo "stalled at $(jq -r .state <<<"$next") — stopping" >&2; exit 1; }
  case "$kind" in
    message) jq -r .content <<<"$next"; exit 0 ;;
    script) bash -c "$(jq -r .content <<<"$next")" >>"$log" 2>&1 || true ;;
    prompt)
      sid="$(jq -r '.sessionId // empty' <<<"$next")"
      [ "$(jq -r '.resume // false' <<<"$next")" = true ] &&
        sf="--resume $sid" || sf="--session-id $sid"
      model="$(jq -r '.model // empty' <<<"$next")"
      claude -p "$(jq -r .content <<<"$next")" $sf \${model:+--model "$model"} \\
        --dangerously-skip-permissions >>"$log" 2>&1
      v="$(gtd validate --json | jq -r '.script // empty')" n=0
      while [ -n "$v" ] && ! out="$(bash -c "$v" 2>&1)"; do
        n=$((n + 1)) && [ "$n" -gt 3 ] && { printf '%s\\n' "$out" >&2; exit 1; }
        claude -p "$out" --resume "$sid" --dangerously-skip-permissions \\
          >>"$log" 2>&1 # $out IS the fix prompt, verbatim
      done ;;
  esac
  gtd_do step "$(jq -r .actor <<<"$next")" || exit 1
  jq -e .settled <<<"$GTD_STEP_JSON" >/dev/null && exit 0
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

\`gtd next --json\` is a read-only PEEK. \`gtd next --json --dispatch\` CLAIMS
the beat: it mints or resumes the session id and arms the beat marker. Dispatch
exactly once per beat.

The \`kind\` field selects what to do:

- \`message\` — print \`.content\` and exit 0. This is a human gate.
- \`script\` — run \`bash -c .content\`, appending its output to \`.log\`, and
  ignore its exit code — the outcome lives in the tree, not in the exit code.
- \`prompt\` — send \`.content\` to your agent CLI.
`

const JSON_FIELD_REFERENCE = `
## JSON field reference

Every field below is always present unless marked "when set".

### \`gtd next --json [--dispatch]\`

- Always: \`state\`, \`actor\`, \`kind\`, \`content\`, \`log\`
- When set: \`model\`, \`memory\`, \`label\`, \`file\`, \`mode\`, \`edges\`
- Only on a DISPATCHED \`prompt\` beat: \`sessionId\` + \`resume\`, together
- \`stalled: true\` only when HEAD is an empty attempt at the resting state and
  the tree is clean (derived from history, not a marker) — never emitted as
  \`false\`

### \`gtd step --json\` (also \`--entry\`)

\`state\`, \`subject\` (\`null\` on a no-op), \`required\`, \`optional\`, \`settled\`;
\`cost\`/\`model\` when recorded. \`--entry\` omits \`settled\` — read it as
\`.settled // false\`.

### \`gtd abandon\`/\`gtd restore --json\`

\`required\`, \`optional\` (always \`""\`).

### \`gtd validate --json\`

\`state\`, \`script\` (\`""\` means nothing to validate); \`file\`/\`mode\` when the
resolved rest declares them. On a non-zero run the script's own output IS the
fix prompt, verbatim.

### The error envelope

\`{"state":"error","prompt":"<message>"}\` on stdout, plus a single \`gtd: \`
line on stderr, exit 1 — this covers usage errors and defects too.
`

const DRIVER_OBLIGATIONS = `
## Driver obligations, in order

1. Opening move: run \`gtd step human --if-resting\`, unconditionally, before
   you know whose turn it is.
2. Dispatch exactly one \`gtd next --json --dispatch\` per beat.
3. A \`.stalled\` beat halts the driver with a non-zero exit.
4. Run scripts with their output appended to \`.log\` — gtd never creates or
   truncates that file itself; truncate it once per run. \`$GTD_LOOP_LOG\`
   overrides its path.
5. Map \`sessionId\`/\`resume\` onto the agent CLI's own session flags.
6. After a \`prompt\` beat, run \`gtd validate --json\`'s \`.script\` and
   re-prompt its output verbatim on failure — the DRIVER owns the retry cap,
   not gtd.
7. Run \`gtd step <actor> --json\`, then execute its \`required\` (always) and
   \`optional\` (presentation only — its failure is a warning, not a halt).
8. \`.settled\` exits 0 — there is nothing left to do.
`

const RECOVERY = `
## Recovery

gtd itself exiting non-zero means nothing was attempted — a refusal or a
usage error. An emitted script exiting non-zero when YOU run it means
something MAY have partially happened. Both recover the same way:
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
