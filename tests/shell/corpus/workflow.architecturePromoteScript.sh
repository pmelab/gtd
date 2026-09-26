#!/usr/bin/env sh
set +e
mkdir -p .gtd/packages
title=$(awk '/^```/{f=!f} !f && /^## /{sub(/^## /,""); print; exit}' .gtd/REQUIREMENTS.md)
[ -z "$title" ] && title=package
slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-*//; s/-*$//')
[ -z "$slug" ] && slug=package
mv .gtd/REQUIREMENTS.md ".gtd/packages/01-${slug}.md"
