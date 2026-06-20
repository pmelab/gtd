feat(git): add review-base resolution operations

Add resolveDefaultBranch, mergeBase, lastReviewCommit, commitCount, and
isAncestor to GitService, with unit tests. These primitives let the upcoming
human-review step compute the review base from git state (parent-branch
merge-base vs. last review commit, whichever is closer to HEAD).
