#!/usr/bin/env sh
set +e
# Anchor on the most recent commit that DELETED .gtd/ESCALATION.md
# — under `healthGate.check`'s own script (above), that ONLY ever
# happens on a genuinely green result, never a still-red round
# (a still-red round leaves an unresolved analysis untouched for
# the next fix attempt to read). So this is reliably "the last
# time this episode's escalation budget was reset" — unlike
# `.gtd/FEEDBACK.md`, which a fix turn deletes on EVERY belief it
# resolved the check, red or green, and so sits between every
# pair of escalation arrivals regardless of episode. With no such
# deletion, the whole process is one unbroken streak since the
# start.
anchor=$(git log --format=%H aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa..HEAD --diff-filter=D -- .gtd/ESCALATION.md 2>/dev/null | head -n 1)
if [ -z "$anchor" ]; then anchor=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fi
# Counting every --diff-filter=AM commit against .gtd/ESCALATION.md
# would also count the HUMAN's own edit at `stop` — landing that
# edit produces an M .gtd/ESCALATION.md commit too, and `stop`'s own
# message explicitly invites that edit. So instead of the file's
# diff history, grep commit SUBJECTS for `describe` as the FROM
# state — `stateSubject`'s "gtd(actor): from → to" shape means the
# commit that lands a `describe` turn's own write always reads
# "... build.health.describe → build.health.stop" (or the
# packages.item.health equivalent), the same narrowing
# `healthGate.check`'s own `episode_anchor` uses above — never the
# human's own "... build.health.stop → build.fix" landing at `stop`.
#
# No `-- .gtd/ESCALATION.md` pathspec on this count: a `prompt`
# state's clean step is an ATTEMPT by design, not a no-op
# (`validateHasCRow`'s own doc comment), so `describe`'s landing
# commit exists every round even when its write is byte-identical
# to what already sits in the tree — a pathspec would silently drop
# that commit from the count (git sees no diff on that path) and
# the 2-round cap would never fire on a repeatedly identical
# analysis.
describe_source='packages.item.health.describe'
rounds=$(git log --format='%s' "$anchor"..HEAD 2>/dev/null | grep -c -F -- "$describe_source →")
if [ "$rounds" -ge 2 ]; then
  # Preserve whatever is already in the tree — including a human's
  # own fresh-instructions edit landed at `exhausted` itself (a
  # "... exhausted → fix" commit this filter never matches, so it's
  # never mistaken for a describe round either) — rather than
  # overwriting it with the machine's last analysis. Only restore
  # from history when the file is genuinely missing.
  if [ ! -f .gtd/ESCALATION.md ]; then
    last=$(git log --format='%H %s' "$anchor"..HEAD -- .gtd/ESCALATION.md 2>/dev/null \
      | grep -F -- "$describe_source →" | head -n 1 | cut -d' ' -f1)
    git show "$last":.gtd/ESCALATION.md > .gtd/ESCALATION.md 2>/dev/null
  fi
  # Stamp with HEAD so this step's own change registers as a real
  # M/A edit even when the tree's content is otherwise unchanged
  # (the common case — nothing else touches the file between
  # rounds), the same technique `healthGate.check`'s own
  # FEEDBACK.md stamp uses.
  printf '\n<!-- gtd escalate %s -->\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/ESCALATION.md
fi
