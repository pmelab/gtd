#!/usr/bin/env sh
# gtd check turn — run the suite; a red run records .gtd/FEEDBACK.md, a
# green run cleans it up. The `on` rules decide what that means.
set +e
mkdir -p .gtd
# Sweep the raw review capture — no path from `deciding`/`collecting`
# reaches this check; this is a leftover sweeper for a capture an
# earlier, abandoned process may have left committed here (see the
# `D .gtd/REVIEW_RAW.md` rows below). A no-op when it is already gone
# or never existed.
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
  # A repeat identical failure would otherwise leave FEEDBACK.md
  # byte-identical to its committed copy — no diff, so the check would
  # look GREEN. Stamp each red run with the current HEAD (which always
  # advances between checks) so a still-red re-run always re-registers
  # as an M/A edit and takes the red edge.
  printf '\n<!-- gtd check %s -->\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/FEEDBACK.md
else
  rm -f .gtd/.check-output
  rm -f .gtd/FEEDBACK.md
fi
