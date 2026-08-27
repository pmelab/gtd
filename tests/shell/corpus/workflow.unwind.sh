#!/usr/bin/env sh
set +e
mkdir -p .gtd
# Hoisted here, at the TOP: Eta's autoTrim eats the newline after
# an interpolation tag, so no tag may be the last token on a line.
# Uses it.currentCommit (render-time), not bare HEAD, so a
# late-running driver still reverts the right commit.
commit="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
git revert --no-commit "$commit" 2> .gtd/.unwind-error
code=$?
# The revert's EXIT CODE is what separates a genuine no-op from a
# hard failure (e.g. a merge commit with no `-m`) — the diff alone
# cannot, since both can leave a clean tree. Turning the failure
# into a FEEDBACK.md write is what makes the `C` row below safe:
# once a failure always has a diff, a clean tree here means the
# revert really did succeed and change nothing.
if [ "$code" -ne 0 ]; then
  printf 'gtd could not unwind %s out of your working tree.\n\n' "$commit" > .gtd/FEEDBACK.md
  if [ -s .gtd/.unwind-error ]; then
    cat .gtd/.unwind-error >> .gtd/FEEDBACK.md
  else
    printf '`git revert --no-commit` exited %s and produced no output.\n' "$code" >> .gtd/FEEDBACK.md
  fi
fi
rm -f .gtd/.unwind-error
