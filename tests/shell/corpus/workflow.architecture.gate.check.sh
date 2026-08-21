#!/usr/bin/env sh
# gtd check turn — probe the current phase's steering file for
# unanswered questions; an answered/empty result removes the marker
# (.gtd/QUESTIONS.md), an unanswered one stamps it fresh. Design and
# architecture share this one probe: whichever of
# .gtd/REQUIREMENTS.md/.gtd/ARCHITECTURE.md exists ON DISK right now
# IS this phase's steering file — unambiguous because
# architecture.author deletes .gtd/REQUIREMENTS.md in the same turn
# it writes .gtd/ARCHITECTURE.md, so exactly one of the two exists
# here.
set +e
mkdir -p .gtd
file=.gtd/REQUIREMENTS.md
[ -f "$file" ] || file=.gtd/ARCHITECTURE.md
gtd check qa "$file" --open-questions > /dev/null 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  printf 'open questions remain in %s\n' "$file" > .gtd/QUESTIONS.md
  # See the shared suite check's cache-buster rationale on
  # `entryGate.check` above.
  printf '\n<!-- gtd check %s -->\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/QUESTIONS.md
else
  rm -f .gtd/QUESTIONS.md
fi
