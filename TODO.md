# Harvest `!!` review comments by review-session diff, not file membership

Review feedback on the Bug 2 (`!!` harvest scoping) change. The reviewer's note,
recorded verbatim on the "Bug 2: scope `!!` harvesting to the reviewed files"
chunk of `REVIEW.md`:

> all comments have to be addressed, also potentially in other files, not
> referenced in REVIEW.md. but it should be clear from the previous git commit
> what was an actual review comment. older "!!" comments can be ignored.

## The problem this exposes

The shipped Bug 2 fix scopes `grepBang` to **files referenced by the current
`REVIEW.md` (its chunk refs) ∪ dirty working-tree paths**. That is still the
wrong axis: it filters by _which files_, not by _which comments are new_. Two
concrete failures:

1. **False positives remain.** This very `review-process` run harvested 12 `!!`
   hits that are all gtd's OWN pre-existing documentation and test fixtures —
   because `REVIEW.md` happens to reference those files as chunks:
   - `README.md:110` and `src/Git.ts:224` — doc text describing the `!!` syntax
   - `src/Git.test.ts:357,366,377,378,388,389,409` — test fixtures
   - `tests/integration/features/spec-harvest.feature:14,47,79,113` — fixtures
     (incl. the `xyzzy-sentinel` string from the out-of-scope scenario)

   None are reviewer feedback; all are old, committed content. File-membership
   scoping cannot tell them apart from a real comment.

2. **False negatives are possible.** A genuine `!!` the reviewer adds during the
   session in a file that `REVIEW.md` does NOT reference would be missed — yet
   the reviewer wants "all comments addressed, also potentially in other files
   not referenced in REVIEW.md".

## Desired behavior

Harvest exactly the `!!` follow-up comments the **reviewer introduced during the
review session** — identifiable from the session's own changes (the "previous
git commit") — regardless of which files `REVIEW.md` references. Pre-existing
(`older`) `!!` comments anywhere are ignored: never harvested, never stripped.

So the scope axis changes from "files in REVIEW.md ∪ dirty" to "`!!` lines ADDED
since the review baseline" (the reviewer's session diff).

## Direction to develop (for grilling)

- **Baseline to diff against.** "The previous git commit" likely means the
  review session's starting point. In `review-process`, the raw-feedback commit
  (`docs(review): record raw feedback for <base>`) captures the reviewer's tree;
  the prior state is the `review(gtd): create review …` commit (or the
  `<!-- base: … -->` ref). Decide the exact baseline: probably "added `!!` lines
  in `git diff <reviewCreateCommit>..<workingTree>`", i.e. only `+` lines
  carrying `!!`.
- **Mechanism.** Replace/augment the pathspec approach in `grepBang`
  (`src/Git.ts`) + its caller in `gatherEvents` (`src/Events.ts`): instead of
  greppping whole files in a pathspec, restrict to `!!` occurrences on lines
  ADDED relative to the baseline (e.g. parse `git diff` added lines, or
  `git diff` + filter). Pre-existing `!!` on unchanged lines are dropped even in
  a referenced/dirty file.
- **Stripping.** Step 4.3 strips harvested `!!` from source. Stripping must
  likewise touch only the reviewer-added `!!` lines, never pre-existing ones, so
  gtd's own docs/fixtures are never mutated (the original Bug 2 motivation).
- **Empty/no-review fallback.** Keep "no harvest when no review baseline
  resolves" (the existing resolved decision).
- **Tests.** Add coverage: a reviewer-added `!!` in a file NOT referenced by
  `REVIEW.md` IS harvested; a pre-existing `!!` in a referenced file is NOT
  harvested (this run's false-positive list is the fixture); stripping leaves
  pre-existing `!!` untouched. The existing `spec-harvest` scenarios must keep
  passing or be updated to the added-line semantics.

## Note on this run

Per the reviewer's "older `!!` comments can be ignored", the 12 harvested hits
above were treated as pre-existing noise: they were NOT pulled in as tasks and
NOT stripped from source (stripping gtd's own docs/fixtures is exactly the
corruption to avoid). They appear here only as evidence motivating the change.
