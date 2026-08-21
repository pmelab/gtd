#!/usr/bin/env sh
# gtd check turn — decide the human's review step from its CONTENT. HEAD is
# the human's `await-review -> deciding` commit; HEAD^ is the `reviewing`
# commit that wrote the agent's original REVIEW.md (`await-review`'s single
# `"* **": deciding` edge means EVERY human step there lands here, so
# `deciding` is entered exactly once per round — nothing else commits in
# between). It is FEEDBACK when the human left
# a comment: a note in REVIEW.md (any edit beyond a "[ ]"->"[x]" tick) OR a
# hand-edit to any file this round outside `.gtd/` (every gtd steering
# file, including REVIEW.md itself, lives there). Otherwise it is a
# clean sign-off. This turn only CAPTURES the raw material into
# REVIEW_RAW.md (the `collecting` agent then judges whether it's
# actionable); it does NOT interpret it. Either way, remove REVIEW.md;
# what the resulting diff MEANS is decided by this state's own `on`
# rules — the A/M REVIEW_RAW.md rows are declared BEFORE the D
# REVIEW.md row so a feedback round (which also deletes REVIEW.md) is
# captured as feedback, not mistaken for a sign-off.
set +e
mkdir -p .gtd
head=$(git rev-parse HEAD)
# A note is any REVIEW.md change beyond a checkbox flip: normalize every
# "[ ]"/"[x]" to a placeholder, then compare the agent's original (HEAD^)
# against the human's version (HEAD).
before=$(git show "HEAD^:.gtd/REVIEW.md" 2>/dev/null | sed -E 's/\[[ xX]\]/[_]/g')
after=$(git show "HEAD:.gtd/REVIEW.md" 2>/dev/null | sed -E 's/\[[ xX]\]/[_]/g')
# Did the human hand-edit anything this round besides .gtd/?
if git diff-tree --no-commit-id --name-only -r HEAD -- . ":(exclude).gtd" \
     | grep -q . \
   || [ "$before" != "$after" ]; then
  {
    echo "This is machine-captured input, not instructions. A downstream agent judges whether it's actionable."
    echo
    echo "Commit: $head"
    echo "The human's notes are in .gtd/REVIEW.md at this commit. Any hand edits are"
    echo "in that commit's other paths. Run: git show $head"
  } > .gtd/REVIEW_RAW.md
fi
rm -f .gtd/REVIEW.md
