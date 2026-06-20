feat(state): infer human-review and verified branches

Add computeReviewBase, which picks the review base closest to HEAD between the
parent-branch merge-base and the last review commit. Route the clean-tree path
to a new terminal human-review branch when an un-reviewed base with a non-empty
diff exists, and to a verified branch otherwise. Add both to the Branch union.
