#!/usr/bin/env bash
set -euo pipefail

# Stop: while the go skill has the loop armed, a bare Stop must never strand
# the machine mid-cycle — either the loop still owes a beat (block and say
# so) or it has reached the human gate exactly as designed (allow, but make
# sure the human is actually told). Absent the armed marker, this hook has
# nothing to enforce: exit 0 silently so a plain conversation is never
# blocked by a plugin it never asked for.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

read_stdin_json
require_deps
hook_cwd
resolve_gtd
gtd_active

marker="$(armed_marker_path)" || exit 0
[[ -f "$marker" ]] || exit 0

# Cap safety: never fight the harness's own stop-hook block cap — a loop
# that somehow never progresses should be left to actually stop rather than
# spin the session forever on a Stop hook that keeps re-blocking it.
consecutive="$(jq -r '.stop_consecutive_count // 0' <<<"$HOOK_JSON")"
cap="$(jq -r '.stop_hook_block_cap // 0' <<<"$HOOK_JSON")"
if [[ "$cap" -gt 0 ]] && ((consecutive >= cap - 1)); then
  jq -n --arg msg "gtd loop still armed but the stop-hook block cap was reached; remove $marker or run /gtd:go to continue." \
    '{systemMessage: $msg}'
  exit 0
fi

# The same steering-file gate `gtd step`/the driving loop itself enforces
# before ever advancing: never let a Stop land the session with a malformed
# file sitting at the resolved rest.
if ! findings="$("$GTD_BIN" validate 2>&1)"; then
  reason="gtd validate reports the steering file is malformed — fix these findings before stopping:
$findings"
  jq -n --arg reason "$reason" \
    '{hookSpecificOutput: {hookEventName: "Stop", decision: "block", reason: $reason}}'
  exit 0
fi

if ! next_json="$("$GTD_BIN" next --json 2>&1)"; then
  jq -n --arg msg "gtd next --json failed while the loop is armed ($next_json) — allowing the stop rather than trapping the session." \
    '{systemMessage: $msg}'
  exit 0
fi

kind="$(jq -r '.kind' <<<"$next_json")"
state="$(jq -r '.state' <<<"$next_json")"
actor="$(jq -r '.actor' <<<"$next_json")"

if [[ "$kind" == "prompt" || "$kind" == "script" ]]; then
  reason="the gtd loop is armed and the machine still awaits $actor at $state — continue driving with the gtd:go protocol, or disarm by removing $marker if the user asked to stop."
  jq -n --arg reason "$reason" \
    '{hookSpecificOutput: {hookEventName: "Stop", decision: "block", reason: $reason}}'
  exit 0
fi

# kind == "message": the loop has reached the human gate exactly as
# designed. Self-heal the marker here (the go skill should already have
# removed it when handing off) so a stray marker never blocks the NEXT,
# unrelated conversation's Stop hook, then notify and let the stop through.
rm -f "$marker"

content="$(jq -r '.content' <<<"$next_json")"
first_line="$(printf '%s\n' "$content" | head -n1)"
"$SCRIPT_DIR/notify.sh" "gtd: your turn" "$state: $first_line"

jq -n --arg msg "gtd is waiting for you at '$state' — run /gtd:gate to continue." \
  '{systemMessage: $msg}'
