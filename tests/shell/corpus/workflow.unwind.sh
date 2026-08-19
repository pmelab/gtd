#!/usr/bin/env sh
# gtd check turn — revert the entry commit's diff out of the working
# tree. Its content survives in history for design.triage to read.
set +e
# Hoist the commit hash once, at the TOP: Eta's autoTrim eats the
# newline after an interpolation tag, so no tag may be the last
# token on a line.
commit="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
git revert --no-commit "$commit"
