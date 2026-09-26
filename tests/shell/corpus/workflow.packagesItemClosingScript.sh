#!/usr/bin/env sh
# Removes the just-reviewed package file (path in NEXT.md) plus
# leftover spec feedback/evidence, so picking selects the next.
# Reached only on spec-review approval — that loop carries no retry
# cap, so there is no force-close path here.
set +e
pkg=$(cat .gtd/NEXT.md 2>/dev/null)
[ -n "$pkg" ] && rm -f "$pkg"
rm -f .gtd/SPEC_FEEDBACK.md .gtd/NEXT.md .gtd/SATISFIED.md
