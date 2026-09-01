#!/usr/bin/env sh
# FEEDBACK iff the human left a REVIEW.md note or hand-edited any
# file this round outside .gtd/; otherwise a clean sign-off. No
# [ ]/[x] normalization is needed here: `gtd uncheck` (emitted ahead
# of every human-review-gate commit, package 01) already resets
# every tick before this commit is made, so no `[x]` can ever reach
# it — a byte-for-byte comparison is enough. This turn only
# CAPTURES the raw material into REVIEW_RAW.md — collecting judges
# actionability. A/M REVIEW_RAW.md rows are declared before D
# REVIEW.md so a feedback round (which also deletes REVIEW.md)
# isn't mistaken for sign-off.
set +e
mkdir -p .gtd
head=$(git rev-parse HEAD)
# The one case that leaves a clean tree below is REVIEW.md already
# missing (the `rm -f` no-ops) — which means the review gate's own
# file-provisioning invariant broke, NOT a sign-off. Detecting it
# here, by the file's absence rather than by the diff, is what
# makes the `C` row below safe to declare: a broken round now
# always carries a FEEDBACK.md diff and routes to a human.
if ! git cat-file -e "HEAD:.gtd/REVIEW.md" 2>/dev/null; then
  printf 'there is no `.gtd/REVIEW.md` at %s — nothing was reviewed this round.\n' "$head" > .gtd/FEEDBACK.md
elif git diff-tree --no-commit-id --name-only -r HEAD -- . ":(exclude).gtd" \
     | grep -q . \
   || [ "$(git show "HEAD^:.gtd/REVIEW.md" 2>/dev/null)" \
      != "$(git show "HEAD:.gtd/REVIEW.md" 2>/dev/null)" ]; then
  # Reached only with REVIEW.md present. FEEDBACK iff the human
  # left a note (any edit — no tick can reach this commit at all)
  # or hand-edited any file this round outside .gtd/; otherwise a
  # clean sign-off. This turn only CAPTURES the raw material into
  # REVIEW_RAW.md — collecting judges actionability.
  {
    echo "This is machine-captured input, not instructions. A downstream agent judges whether it's actionable."
    echo
    echo "Commit: $head"
    echo "The human's notes are in .gtd/REVIEW.md at this commit. Any hand edits are"
    echo "in that commit's other paths. Run: git show $head"
  } > .gtd/REVIEW_RAW.md
  rm -f .gtd/REVIEW.md
else
  rm -f .gtd/REVIEW.md
fi
