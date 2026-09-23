#!/usr/bin/env sh
set +e
mkdir -p .gtd
rm -f .gtd/PRIOR_FEEDBACK.md
# Sweep a raw review capture an earlier, abandoned process may have
# left behind — no ordinary path from deciding/collecting reaches
# this check (same as entryGate.check's own sweep).
rm -f .gtd/REVIEW_RAW.md
# Bound the PRIOR_FEEDBACK.md search to the CURRENT episode, not the
# whole process (`it.startCommit`): HEAD's own subject already reads
# "... → build.health.check" (the commit that just entered this check —
# `PatternMachine.ts`'s `stateSubject`/`TRANSITION_SEP`), so the
# SECOND most recent such subject is the last time this exact check
# was entered before now. Reaching THIS check always requires
# passing through it (green or red), so that prior entry is never
# itself carrying an unrelated gate's FEEDBACK.md the way
# `it.startCommit` (spanning the whole process, every earlier gate
# included) could. No second match at all means this is the very
# first visit ever — nothing to bound against, so there is no prior
# round full stop (never falls back to `it.startCommit`, which would
# reintroduce exactly the cross-episode leak this bounds against).
episode_anchor=$(git log --format='%H %s' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa..HEAD \
  | grep -F -- ' → build.health.check' | sed -n '2p' | cut -d' ' -f1)
if [ -n "$episode_anchor" ]; then
  prior_commit=$(git log --format=%H --diff-filter=AM "$episode_anchor"..HEAD -- .gtd/FEEDBACK.md 2>/dev/null | head -n 1)
  if [ -n "$prior_commit" ]; then
    git show "$prior_commit":.gtd/FEEDBACK.md > .gtd/PRIOR_FEEDBACK.md 2>/dev/null
  fi
fi
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
  rm -f .gtd/PRIOR_FEEDBACK.md
  # `.gtd/ESCALATION.md` is swept ONLY here, on a genuinely green
  # result — never on a still-red round, so an unresolved analysis
  # a fix turn left in place (fixFeedbackPrompt never deletes it)
  # survives every retry within the same episode. That also makes
  # its deletion a reliable "this episode's escalation budget just
  # reset" signal: `escalate`'s own script (below) anchors its
  # round count on the most recent such deletion.
  rm -f .gtd/ESCALATION.md
fi
