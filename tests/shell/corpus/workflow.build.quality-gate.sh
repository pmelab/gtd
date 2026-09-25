#!/usr/bin/env sh
set +e
if [ -f .gtd/QUALITY_DONE.md ]; then
  printf '\n<!-- gtd quality-gate %s -->\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/QUALITY_DONE.md
fi
