#!/usr/bin/env sh
set +e
mkdir -p .gtd
# Sweep a raw review capture an earlier, abandoned process may have
# left behind — no ordinary path from deciding/collecting reaches
# this check (same as entryGate.check's own sweep).
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
  # `.gtd/ESCALATION.md` is swept ONLY here, on a genuinely green
  # result — never on a still-red round, so an unresolved analysis
  # a fix turn left in place (fixFeedbackPrompt never deletes it)
  # survives every retry within the same episode. That also makes
  # its deletion a reliable "this episode's escalation budget just
  # reset" signal: `escalate`'s own script (below) anchors its
  # round count on the most recent such deletion.
  rm -f .gtd/ESCALATION.md
fi
