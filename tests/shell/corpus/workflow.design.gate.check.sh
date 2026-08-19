#!/usr/bin/env sh
# gtd check turn — probe the current phase's steering file for
# unanswered questions; an answered/empty result removes the marker
# (questionsFile), an unanswered one stamps it fresh. Design and
# architecture share this one probe: whichever of
# requirementsFile/architectureFile exists ON DISK right now IS this
# phase's steering file — unambiguous because architecture.author
# deletes requirementsFile in the same turn it writes
# architectureFile, so exactly one of the two exists here.
set +e
mkdir -p ".gtd"
# Hoist every path once, at the TOP: Eta's autoTrim eats the newline
# after an interpolation tag, so no tag may be the last token on a
# line — it would glue the next line's `else`/`fi` onto it and break
# the script. Below this point everything is plain POSIX sh.
questions=".gtd/QUESTIONS.md"
mkdir -p "$(dirname "$questions")"
requirements=".gtd/REQUIREMENTS.md"
architecture=".gtd/ARCHITECTURE.md"
file="$requirements"
[ -f "$file" ] || file="$architecture"
gtd check qa "$file" --open-questions > /dev/null 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  printf 'open questions remain in %s\n' "$file" > "$questions"
  # A repeat identical result would otherwise leave the marker
  # byte-identical to its committed copy — no diff, so the check
  # would look answered. Stamp each round with the current HEAD
  # (which always advances between checks) so a still-open re-run
  # always re-registers as an M/A edit and takes the answer edge.
  printf '\n<!-- gtd check %s -->\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> "$questions"
else
  rm -f "$questions"
fi
