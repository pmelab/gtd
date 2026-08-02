#!/usr/bin/env bash
set -euo pipefail

# notify.sh <title> <body> — best-effort desktop notification for CLI/desktop
# sessions reaching a gtd human gate. A hook process must never fail the
# harness's turn over a notifier that isn't installed (no notify-send on a
# headless box, no osascript outside macOS), so every path here is a silent,
# always-exit-0 no-op when it can't notify.
title="${1:-gtd}"
body="${2:-}"

if [[ "$(uname -s 2>/dev/null)" == "Darwin" ]] && command -v osascript >/dev/null 2>&1; then
  # AppleScript string literals: escape backslashes then double quotes so an
  # arbitrary title/body can never break out of the quoted literal.
  esc_title="${title//\\/\\\\}"
  esc_title="${esc_title//\"/\\\"}"
  esc_body="${body//\\/\\\\}"
  esc_body="${esc_body//\"/\\\"}"
  osascript -e "display notification \"$esc_body\" with title \"$esc_title\"" >/dev/null 2>&1 || true
elif command -v notify-send >/dev/null 2>&1; then
  notify-send -- "$title" "$body" >/dev/null 2>&1 || true
fi

exit 0
