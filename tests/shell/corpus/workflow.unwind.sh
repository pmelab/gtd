#!/usr/bin/env sh
set +e
# Hoisted here, at the TOP: Eta's autoTrim eats the newline after
# an interpolation tag, so no tag may be the last token on a line.
# Uses it.currentCommit (render-time), not bare HEAD, so a
# late-running driver still reverts the right commit.
commit="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
git revert --no-commit "$commit"
