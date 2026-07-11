#!/bin/bash
set -euo pipefail

input="$(cat)"
stop_hook_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false')"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // empty')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // "unknown"')"

# Avoid re-triggering on the extra turn this hook itself causes.
if [ "$stop_hook_active" = "true" ]; then
  exit 0
fi

if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
  exit 0
fi

tool_call_count="$(grep -c '"type":"tool_use"' "$transcript_path" 2>/dev/null || echo 0)"

state_file="/tmp/claude-permission-scan-state-${session_id}"
last_count=0
if [ -f "$state_file" ]; then
  last_count="$(cat "$state_file")"
fi

delta=$((tool_call_count - last_count))
threshold=25

if [ "$delta" -lt "$threshold" ]; then
  exit 0
fi

echo "$tool_call_count" > "$state_file"

cat <<'JSON'
{"decision": "block", "reason": "A good chunk of tool calls has happened since permission usage was last reviewed. Before finishing, run the fewer-permission-prompts skill to check whether any newly-repeated commands should be added to .claude/settings.json's allowlist, then finish your turn normally."}
JSON
