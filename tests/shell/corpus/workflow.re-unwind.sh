#!/usr/bin/env sh
# gtd check turn — revert the human's own review edit out of the
# working tree, scoped to real code: stateDir and reviewFile
# (var-configurable, may live at the repo root — issue #128) are
# excluded, because the review file is already gone by this point
# and reverting it would resurrect it. The human's intent survives
# in their own commit for the triage phase to read. The apply is
# EXPECTED to succeed — nothing between that commit and now touches
# a code path — but it can still fail on a clean-filter round-trip,
# a drifted worktree, or a binary path: the `requireRevert`
# step-capture guard (src/StepGuards.ts) catches that by
# re-checking the tree itself before this step is allowed to land.
# The guard's own residue scoping (`isCodePath`) re-derives the same
# stateDir/reviewFile exemption this pathspec renders, from the same
# declaration (never a literal `.gtd/`) — keep the two together
# when either changes. Both exclusions carry `:(exclude,literal)`,
# the same magic `deciding` uses: git's DEFAULT pathspec magic is
# glob-ish (`*` even crosses `/`), and nothing validates a
# metacharacter out of either value — `stateDirError` rejects only
# blanks/root/absolute/`..`/non-canonical segments, and `reviewFile`
# is an ordinary var. A bare `:(exclude)` therefore lets a `*`/`?`/
# `[` in either value drop a REAL edited path out of the patch,
# which the guard (a plain string comparison, not a pathspec) then
# scores as residue and refuses forever.
set +e
commit="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
stateDir=".gtd"
reviewFile=".gtd/REVIEW.md"
patch="$stateDir/.re-unwind.patch"
mkdir -p "$stateDir"
git diff --binary "$commit^" "$commit" -- . \
  ":(exclude,literal)$stateDir" ":(exclude,literal)$reviewFile" > "$patch"
if [ -s "$patch" ]; then
  git apply -R "$patch" || echo "re-unwind: could not revert $commit" >&2
fi
rm -f "$patch"
