#!/usr/bin/env bash
set -euo pipefail

# SessionStart: give a fresh (or resumed) session ambient awareness of where
# the gtd machine currently rests, so nobody has to run `gtd status` by hand
# just to learn whether the go skill or the gate skill is the next move.
# Every guard below must fail silently (no additionalContext, no error) —
# this hook fires in EVERY session, gtd-active or not, and must never be the
# reason an ordinary session's start looks broken.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

read_stdin_json
require_deps
hook_cwd
resolve_gtd
gtd_active

# Both calls are pure (`gtd next`/`gtd status` never mutate the repo) — safe
# to run unconditionally at session start. Either failing (a malformed
# custom workflow, a detached-HEAD repo, whatever) must not break the
# session: fall silent rather than surface a raw error to the user.
next_json="$("$GTD_BIN" next --json 2>/dev/null)" || exit 0
status_json="$("$GTD_BIN" status --json 2>/dev/null)" || exit 0

state="$(jq -r '.state' <<<"$next_json")"
actor="$(jq -r '.actor' <<<"$next_json")"
kind="$(jq -r '.kind' <<<"$next_json")"
pending="$(jq -r '.changes | length' <<<"$status_json")"

if [[ "$kind" == "message" ]]; then
  pointer="the gtd workflow is waiting at a human gate — the gtd:gate skill runs the gate conversation."
else
  pointer="autonomous work is pending — the gtd:go skill drives the loop."
fi

context="$(printf 'gtd status: state "%s", awaited actor "%s", kind "%s".\n%s\n%s pending change(s) in the working tree.' \
  "$state" "$actor" "$kind" "$pointer" "$pending")"

jq -n --arg ctx "$context" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
