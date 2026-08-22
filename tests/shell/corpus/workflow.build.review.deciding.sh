#!/usr/bin/env sh
# FEEDBACK iff the human left a REVIEW.md note (any edit beyond a
# checkbox tick) or hand-edited any file this round outside .gtd/;
# otherwise a clean sign-off. This turn only CAPTURES the raw
# material into REVIEW_RAW.md — collecting judges actionability.
# A/M REVIEW_RAW.md rows are declared before D REVIEW.md so a
# feedback round (which also deletes REVIEW.md) isn't mistaken for
# sign-off.
set +e
mkdir -p .gtd
head=$(git rev-parse HEAD)
# Normalize [ ]/[x] before diffing, so only a real note counts.
before=$(git show "HEAD^:.gtd/REVIEW.md" 2>/dev/null | sed -E 's/\[[ xX]\]/[_]/g')
after=$(git show "HEAD:.gtd/REVIEW.md" 2>/dev/null | sed -E 's/\[[ xX]\]/[_]/g')
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
