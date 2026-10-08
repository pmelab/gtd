#!/usr/bin/env sh
set +e
if [ -z "$SKIP" ]; then
  exit 0
fi
mkdir -p "$(dirname '.gtd/FEEDBACK.md')"
(
npm test
) > '.gtd/FEEDBACK.md.output' 2>&1
code=$?
if [ "$code" -ne 0 ]; then
  if [ -s '.gtd/FEEDBACK.md.output' ]; then
    mv '.gtd/FEEDBACK.md.output' '.gtd/FEEDBACK.md'
  else
    rm -f '.gtd/FEEDBACK.md.output'
    printf 'the test command failed with exit code %s and produced no output.' "$code" > '.gtd/FEEDBACK.md'
  fi
  printf '\n<!-- gtd check %s -->\n' 'abc1234' >> '.gtd/FEEDBACK.md'
else
  rm -f '.gtd/FEEDBACK.md.output' '.gtd/FEEDBACK.md'
fi
