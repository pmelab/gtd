#!/usr/bin/env bash
set -euo pipefail

# PreToolUse (Bash): while the go skill has the loop armed, gtd itself owns
# authoring history via `gtd step` — a Bash tool call running its own git
# commit/rebase/merge/cherry-pick/reset would fight the pattern machine for
# the same repository. A disarmed session (an ordinary conversation, or a
# human explicitly done with the loop) is never touched.
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

tool_name="$(jq -r '.tool_name // empty' <<<"$HOOK_JSON")"
[[ "$tool_name" == "Bash" ]] || exit 0

command="$(jq -r '.tool_input.command // empty' <<<"$HOOK_JSON")"
[[ -n "$command" ]] || exit 0

# Conservative on purpose: anchored on the git SUBCOMMAND position (allowing
# the handful of flags that can precede it, e.g. `-C <path>`/`-c k=v`), never
# on the bare word appearing anywhere in the string — `git log --format=%s |
# grep commit` must never trip this; only an actual
# commit/rebase/merge/cherry-pick/reset invocation should. False denies are
# worse than misses here, so when in doubt this stays narrow.
history_re='(^|[;&|(]|[[:space:]])git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--git-dir=[^[:space:]]+|--work-tree=[^[:space:]]+|-[A-Za-z]|--[A-Za-z0-9-]+))*[[:space:]]+(commit|rebase|merge|cherry-pick|reset)([^A-Za-z0-9_-]|$)'

if [[ "$command" =~ $history_re ]]; then
  reason="the gtd loop is armed and gtd owns history during a process — the driver's \`gtd step\` authors the commits; if you're acting for the user, disarm first by removing $marker"
  jq -n --arg reason "$reason" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
fi
