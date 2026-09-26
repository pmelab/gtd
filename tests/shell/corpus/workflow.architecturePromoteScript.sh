#!/usr/bin/env sh
set +e
# `architecture-pre`'s judged "no" was answered against a
# judgeBudgetBytes-bound payload — a plan over the budget can have
# structural concerns cut away from the
# TOP before the judge ever saw them, and still clear
# architectureSkipMinP confidently. The truncation is refused
# here, however confident that "no" was: on a truncated landing
# commit, this script does nothing at all, and the clean tree
# routes to the full architecture pass instead of a false
# promotion.
if git log -1 --format=%B HEAD | grep -q 'Gtd-Payload: {"truncated":true}'; then
  exit 0
fi
mkdir -p .gtd/packages
title=$(awk '/^```/{f=!f} !f && /^## /{sub(/^## /,""); print; exit}' .gtd/REQUIREMENTS.md)
[ -z "$title" ] && title=package
slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-*//; s/-*$//')
[ -z "$slug" ] && slug=package
mv .gtd/REQUIREMENTS.md ".gtd/packages/01-${slug}.md"
