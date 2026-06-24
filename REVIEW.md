# Review: e44f86a

<!-- base: e44f86a2d5e2df762a2b131782affff0c0d0e9e7 -->

refactored review process:

- REVIEW.md is initially created
- user makes changes to REVIEW.md _and_ leaves `!!` comments in code
- both are committed verbatim in a single commit for reference, no agent
  involved (commit "x")
- instruct agent to generate TODO.md from diff of commit "x" and commit TODO.md
- revert commit "x"
- remove REVIEW.md

that should leave no artifacts in code and provide maximum reliability

## grepBangAdded: harvest by review-session diff

`grepBang(pathspec)` is replaced by `grepBangAdded(baseRef)`: it diffs the
working tree against the `review(gtd): create review …` commit, intent-to-adds
untracked paths (mirroring `diffHead`), and emits a `BangComment` for every `!!`
on an added (`+`) line, with the line number computed from hunk headers. The
`{file, line, text}` shape is unchanged; `:!REVIEW.md`/`:!TODO.md` stay
excluded. This filters by _which comments are new_, not _which files_ — fixing
both the false positives (gtd's own `!!` docs/fixtures) and false negatives
(reviewer `!!` in unreferenced files) of the prior file-membership scoping.

- [ ] ./src/Git.ts#21
- [ ] ./src/Git.ts#220
- [ ] ./src/Git.test.ts#352

## gatherEvents uses the review-commit baseline

The pathspec construction (chunk refs ∪ dirty paths) is dropped; `gatherEvents`
calls `grepBangAdded(reviewCommit.value)` when `lastReviewCommit()` is `Some`,
else harvests nothing.

- [ ] ./src/Events.ts#246
- [ ] ./src/Events.ts#261

## Read-only harvest — semantics to confirm

Step 4.3's "strip `!!` from source" instruction is dropped; the prompt and
README now describe harvesting as read-only. **Please scrutinize this** (it
relates to your git-revert question): a reviewer's `!!` edit is uncommitted on
the first run, where `code-changes` commits it (leaving `REVIEW.md` dirty, per
the earlier Bug 1 fix) — so by the time `review-process` runs, the `!!` is
already **committed**. The Step 7 reset only reverts _uncommitted_ edits, so it
does **not** remove the committed `!!`. Net: the comment is captured into
`TODO.md` but **lingers in the source history** (it is not re-harvested later,
since the next review's baseline includes it). If you want the `!!` line
mechanically removed, that needs an explicit step — it is not happening today.

- [ ] ./src/prompts/review-process.md#40
- [ ] ./README.md#108

## Tests: realistic added-after-review ordering

The Git unit tests and spec-harvest scenarios now introduce the `!!` _after_ the
review-create commit (matching reality — `code-changes` commits the reviewer's
source edits first). Adds an "unreferenced reviewer-added `!!` IS harvested"
scenario and a false-positive guard proving a pre-existing (committed-at-base)
`!!` is NOT harvested.

- [ ] ./tests/integration/features/spec-harvest.feature#118
- [ ] ./tests/integration/features/spec-harvest.feature#185
- [ ] ./tests/integration/features/spec-harvest.feature#15
