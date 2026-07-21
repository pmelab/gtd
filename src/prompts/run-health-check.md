#!/usr/bin/env bash
# gtd check turn (health) — run this script verbatim, then: gtd step check
# (or let `gtd run` do both). Mechanics only: it runs the configured check
# and records a red run's output as .gtd/HEALTH.md. What that output MEANS
# (fix round vs escalation, whether green chains into learning/squash) is
# decided when the turn is captured — never here.
set +e
mkdir -p .gtd
<%~ it.context.testCommand %> > .gtd/.check-output 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  if [ -s .gtd/.check-output ]; then
    mv .gtd/.check-output .gtd/HEALTH.md
  else
    rm -f .gtd/.check-output
    printf 'Test command `%s` failed with exit code %s and produced no output.' '<%~ it.context.testCommand %>' "$code" > .gtd/HEALTH.md
  fi
else
  rm -f .gtd/.check-output
fi
