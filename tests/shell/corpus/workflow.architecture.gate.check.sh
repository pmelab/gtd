#!/usr/bin/env sh
# Exactly one of REQUIREMENTS.md/ARCHITECTURE.md exists on disk at
# a time — architecture.author deletes the former in the same turn
# it writes the latter — so this probe is unambiguous either way.
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
