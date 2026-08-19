#!/usr/bin/env sh
# gtd check turn (the package closer) — remove the just-reviewed package
# file (its path is in NEXT.md) plus any leftover spec feedback and
# already-satisfied evidence, so `picking` selects the NEXT package (or
# falls through to review when the queue is empty). Reached on approval
# (spec review clean) and on the spec review retry cap (force-close,
# deferring the concern to the tail).
set +e
pkg=$(cat .gtd/NEXT.md 2>/dev/null)
[ -n "$pkg" ] && rm -f "$pkg"
rm -f .gtd/SPEC_FEEDBACK.md .gtd/NEXT.md .gtd/SATISFIED.md
