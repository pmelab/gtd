#!/usr/bin/env sh
# Mechanics only — NEXT.md's presence/absence is interpreted by
# the `on` rows below, never here.
set +e
mkdir -p .gtd
# Sweep spent design/architecture steering files (gone by now), any
# REVIEW_RAW.md the review loop-back left behind, and the quality
# lap's own state (its queue, its picked lens, its findings and
# markers) — the only sweeper on that path before any of these
# would leak into a later `gtd summary` prompt's diff range. A
# feedback loop-back therefore clears `.gtd/QUALITY_DONE.md` too,
# re-running the whole lap.
rm -f .gtd/REQUIREMENTS.md .gtd/ARCHITECTURE.md .gtd/QUESTIONS.md .gtd/REVIEW_RAW.md .gtd/NEXT_REVIEW.md .gtd/QUALITY*.md
rm -rf .gtd/reviews
# Names are gtd-authored, never containing whitespace — safe to
# disable SC2012.
# shellcheck disable=SC2012
next=$(ls .gtd/packages/*.md 2>/dev/null | head -n 1)
if [ -n "$next" ]; then
  printf '%s' "$next" > .gtd/NEXT.md
else
  rm -f .gtd/NEXT.md
fi
