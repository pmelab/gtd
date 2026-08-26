#!/usr/bin/env sh
# Mechanics only — NEXT.md's presence/absence is interpreted by
# the `on` rows below, never here.
set +e
mkdir -p .gtd
# Sweep spent design/architecture steering files (gone by now) and
# any REVIEW_RAW.md the review loop-back left behind — the only
# sweeper on that path before it would leak into a later `gtd
# summary` prompt's diff range.
rm -f .gtd/REQUIREMENTS.md .gtd/ARCHITECTURE.md .gtd/QUESTIONS.md .gtd/REVIEW_RAW.md
# Names are gtd-authored, never containing whitespace — safe to
# disable SC2012.
# shellcheck disable=SC2012
next=$(ls .gtd/packages/*.md 2>/dev/null | head -n 1)
if [ -n "$next" ]; then
  printf '%s' "$next" > .gtd/NEXT.md
else
  rm -f .gtd/NEXT.md
fi
