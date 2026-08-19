#!/usr/bin/env sh
# gtd check turn — run the suite; a red run records .gtd/FEEDBACK.md, a
# green run cleans it up. The `on` rules decide what that means.
set +e
mkdir -p ".gtd"
# Hoist the feedback path once, at the TOP: Eta's autoTrim eats the
# newline after an interpolation tag, so no tag may be the last token on
# a line — it would glue the next line's `else`/`fi` onto it and break
# the script. Below this point everything is plain POSIX sh.
feedback=".gtd/FEEDBACK.md"
mkdir -p "$(dirname "$feedback")"
npm test > .gtd/.check-output 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  if [ -s .gtd/.check-output ]; then
    mv .gtd/.check-output "$feedback"
  else
    rm -f .gtd/.check-output
    printf 'the test command failed with exit code %s and produced no output.' "$code" > "$feedback"
  fi
  # A repeat identical failure would otherwise leave FEEDBACK.md
  # byte-identical to its committed copy — no diff, so the check would
  # look GREEN. Stamp each red run with the current HEAD (which always
  # advances between checks) so a still-red re-run always re-registers
  # as an M/A edit and takes the red edge.
  printf '\n<!-- gtd check %s -->\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> "$feedback"
else
  rm -f .gtd/.check-output
  rm -f "$feedback"
fi
