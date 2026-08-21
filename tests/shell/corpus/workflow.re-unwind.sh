#!/usr/bin/env sh
# gtd check turn — revert the human's own review edit out of the
# working tree, scoped to real code: everything under `.gtd/` is
# excluded, because the review file is already gone by this point
# and reverting it would resurrect it. The human's intent survives
# in their own commit for the triage phase to read. The apply is
# EXPECTED to succeed — nothing between that commit and now touches
# a code path — but it can still fail on a clean-filter round-trip,
# a drifted worktree, or a binary path: the `requireRevert`
# step-capture guard (src/StepGuards.ts) catches that by
# re-checking the tree itself before this step is allowed to land.
# The guard's own residue scoping (`isCodePath`) re-derives the same
# `.gtd/` exemption this pathspec renders — keep the two together
# when either changes.
set +e
# Hoist the reverted commit once, at the TOP: Eta's autoTrim eats the
# newline after an interpolation tag, so no tag may be the last token
# on a line.
commit="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
patch=.gtd/.re-unwind.patch
mkdir -p .gtd
git diff --binary "$commit^" "$commit" -- . ":(exclude).gtd" > "$patch"
if [ -s "$patch" ]; then
  git apply -R "$patch" || echo "re-unwind: could not revert $commit" >&2
fi
rm -f "$patch"
