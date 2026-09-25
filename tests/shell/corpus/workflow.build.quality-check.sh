#!/usr/bin/env sh
set +e
# Never created zero-byte: `quality-gate`'s own re-stamp always
# appends a LEADING `\n` (the same separator idiom every other
# stamped file here uses, all created with real content first) —
# on a genuinely empty file that leading blank line is not an
# oxfmt fixed point.
printf 'quality lap drained\n' > .gtd/QUALITY_DONE.md
if [ -s .gtd/QUALITY.md ]; then
  printf '\n<!-- gtd quality-check %s -->\n' "$(git rev-parse --short HEAD 2>/dev/null || echo pending)" >> .gtd/QUALITY.md
else
  rm -f .gtd/QUALITY.md
fi
