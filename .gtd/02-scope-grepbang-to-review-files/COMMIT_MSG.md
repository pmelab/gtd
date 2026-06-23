fix(gtd): scope !! harvesting to the files the review covers

grepBang greps the whole tracked tree, so review-process harvested (and would
strip) every `!!` token anywhere — including gtd's own docs and fixtures
(README.md, example.md, the grepBang doc comment, review-process.md,
spec-harvest.feature). Running gtd over its own repo surfaced these false
positives alongside real feedback.

grepBang now takes a pathspec and greps only those files (keeping the
:!REVIEW.md / :!TODO.md exclusions); an empty pathspec scopes to nothing.
gatherEvents calls it only when REVIEW.md exists, after reading reviewContent,
and passes the union of the files referenced by the current REVIEW.md chunks
(`./path#N` refs) and the dirty working-tree paths. When REVIEW.md is absent,
nothing is harvested. No base-ref resolution is involved — computeReviewBase
returns none on the harvest path and the fixture base is a fake hash, so a
diff-range scope was rejected.

Adds a spec-harvest scenario proving an out-of-scope, non-dirty committed `!!`
comment is not harvested, and updates README.md, SKILL.md, review-process.md and
the grepBang doc comment to describe the scoped behavior.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
