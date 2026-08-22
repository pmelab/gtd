#!/usr/bin/env sh
set +e
mkdir -p .gtd
# Sweep a raw review capture an earlier, abandoned process may have
# left behind — no ordinary path from deciding/collecting reaches
# this check.
rm -f .gtd/REVIEW_RAW.md
npm test > .gtd/.check-output 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  if [ -s .gtd/.check-output ]; then
    mv .gtd/.check-output .gtd/FEEDBACK.md
  else
    rm -f .gtd/.check-output
    printf 'the test command failed with exit code %s and produced no output.' "$code" > .gtd/FEEDBACK.md
  fi
  # Stamp with HEAD so a repeat identical failure still re-registers
  # as an M/A edit instead of looking byte-identical (GREEN).
  printf '\n<!-- gtd check %s -->\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/FEEDBACK.md
else
  rm -f .gtd/.check-output
  rm -f .gtd/FEEDBACK.md
fi
