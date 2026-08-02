#!/usr/bin/env bash
set -euo pipefail

# statusline.sh — Claude Code calls this on every statusline render, so it
# must stay to exactly one gtd invocation and abstain (print nothing) the
# instant any guard fails; a broken or non-gtd project must never show a
# bogus or noisy status line.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
# shellcheck source=../hooks/scripts/lib.sh
source "$SCRIPT_DIR/../hooks/scripts/lib.sh"

read_stdin_json
require_deps
hook_cwd
resolve_gtd
gtd_active

status_json="$("$GTD_BIN" status --json 2>/dev/null)" || exit 0

state="$(jq -r '.state' <<<"$status_json")"
actor="$(jq -r '.actor' <<<"$status_json")"
pending="$(jq -r '.changes | length' <<<"$status_json")"

line="gtd: $state ⇦ $actor"
if [[ "$pending" -gt 0 ]]; then
  line="$line ($pending pending)"
fi

printf '%s\n' "$line"
