fix(harvest): harvest !! by review-session diff, not file membership

The previous fix scoped `!!` harvesting to the files referenced by the current
REVIEW.md (its chunk refs) ∪ dirty working-tree paths. That filters by WHICH
files, not by WHICH comments are new — so it both swept up gtd's own pre-existing
`!!` docs/fixtures (false positives) and missed reviewer `!!` in files REVIEW.md
doesn't reference (false negatives).

Replace `grepBang(pathspec)` with `grepBangAdded(baseRef)`: diff the working
tree against the `review(gtd): create review …` commit (`lastReviewCommit()`),
intent-to-add untracked paths first (mirroring `diffHead`), and emit a
`BangComment` for every `!!` on an added (`+`) line, computing the line number
from hunk headers. The `{file, line, text}` shape is unchanged; REVIEW.md /
TODO.md stay excluded. `gatherEvents` drops the pathspec construction and calls
`grepBangAdded(reviewCommit.value)` when `lastReviewCommit()` is `Some`, else
harvests nothing. Pre-existing (older) `!!` are never harvested.

Harvest is now read-only: the Step 4.3 "strip the `!!` from source" instruction
is dropped because the existing review reset (Step 7 `git checkout -- .` /
`git clean -fd`) already removes the reviewer's uncommitted `!!` lines.

Migrates the Git unit tests and the spec-harvest e2e scenarios to introduce the
`!!` as a working-tree edit AFTER the review-create commit (matching reality),
adds an "unreferenced reviewer-added `!!` IS harvested" scenario and a
false-positive guard for pre-existing `!!`, and updates README.md and
review-process.md to the added-line, read-only semantics.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
