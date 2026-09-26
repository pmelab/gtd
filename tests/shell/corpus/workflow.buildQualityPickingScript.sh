#!/usr/bin/env sh
set +e
# Names are gtd-authored, never containing whitespace — safe to
# disable SC2012.
# shellcheck disable=SC2012
next=$(ls .gtd/reviews/*.md 2>/dev/null | head -n 1)
if [ -n "$next" ]; then
  cp "$next" .gtd/NEXT_REVIEW.md
  rm -f "$next"
else
  rm -f .gtd/NEXT_REVIEW.md
  : > .gtd/QUALITY_DONE.md
  if [ -s .gtd/QUALITY.md ]; then
    : > .gtd/QUALITY_READY.md
  fi
fi
