---
status: complete
---

# Harvest `!!` review comments by review-session diff, not file membership

Review feedback on the Bug 2 (`!!` harvest scoping) change. The reviewer's note,
recorded verbatim on the "Bug 2: scope `!!` harvesting to the reviewed files"
chunk of `REVIEW.md`:

> all comments have to be addressed, also potentially in other files, not
> referenced in REVIEW.md. but it should be clear from the previous git commit
> what was an actual review comment. older "!!" comments can be ignored.

## The problem this exposes

The shipped Bug 2 fix scopes `grepBang` to **files referenced by the current
`REVIEW.md` (its chunk refs) ∪ dirty working-tree paths** (`Events.ts:263-272`).
That filters by _which files_, not by _which comments are new_. Two failures:

1. **False positives.** This `review-process` run harvested 12 `!!` hits that
   are all gtd's OWN pre-existing docs/fixtures, because `REVIEW.md` references
   those files as chunks:
   - `README.md:110`, `src/Git.ts:224` — doc text describing `!!` syntax
   - `src/Git.test.ts:357,366,377,378,388,389,409` — test fixtures
   - `tests/integration/features/spec-harvest.feature:14,47,79,113` — fixtures
     (incl. the `xyzzy-sentinel` out-of-scope string)

   None are reviewer feedback; all are old, committed content.

2. **False negatives.** A genuine `!!` the reviewer adds in a file `REVIEW.md`
   does NOT reference is missed.

## Desired behavior

Harvest exactly the `!!` follow-up comments the **reviewer introduced during the
review session**, identified as `!!` tokens on lines ADDED since the
`review(gtd): create review …` baseline (`git.lastReviewCommit()`), regardless
of file. Pre-existing (`older`) `!!` anywhere are ignored: never harvested.
Reviewer-added `!!` are removed from the tree by the existing review-process
reset (Step 7 `git checkout -- .` / `git clean -fd`), not by a manual strip.

## Implementation (grounded in code)

**Baseline ref:** `git.lastReviewCommit()` (`src/Git.ts:133-145`). At harvest
time (in `gatherEvents`) HEAD IS that commit and the tree is dirty — verified
against this session's `git log`.

**`src/Git.ts` (~202-262):** replace `grepBang(pathspec)` with a baseRef-driven
reader:

- Signature:
  `grepBangAdded(baseRef: string): Effect<ReadonlyArray<BangComment>>`
  (interface decl at `Git.ts:24`).
- `git add --intent-to-add` untracked paths (reuse the `diffHead` pattern,
  `Git.ts:54-66`) so new untracked reviewer files appear in the diff; reset
  after.
- Run `git diff <baseRef> -- ':!REVIEW.md' ':!TODO.md'`.
- Walk hunks: track new-file line counter from `@@ … +c,d @@`; for each `+` line
  matching `(//|#|<!--)[[:space:]]*!!`, emit `{file, line, text}` reusing the
  text-strip regex (`Git.ts:253-256`). `git diff` exit 1 / catchAll → `[]`.

**`src/Events.ts` (~248-272):** in the `reviewExists` block, drop the
`chunkRefPaths ∪ dirtyPaths` pathspec construction; instead resolve
`const reviewCommit = yield* git.lastReviewCommit()` and call
`git.grepBangAdded(reviewCommit.value)` only when `Some`, else
`bangComments = []`. `bangPresent` and the payload spread (`Events.ts:357`)
unchanged. Update the stale comment at `Events.ts:248-250` and the doc comment
at `Git.ts:223-229`.

**`src/prompts/review-process.md` (Step 4.3, lines 42-49):** reword the harvest
source to "the reviewer-added `!!` (`!!` tokens on lines added since the
`review(gtd): create review …` commit), by file+line, regardless of which files
REVIEW.md references". **DROP the trailing
`After capturing, strip the !! comments from the source.` sentence** — it is now
redundant (see "Why no manual strip / git revert" below). The reset in Step 7
already removes those lines.

**Tests:** `tests/integration/features/spec-harvest.feature` — the `!!` must be
introduced as a **working-tree edit after** the `review(gtd): create review …`
commit (reality: `!!` always lands during the review session, never before it).
Concretely: commit the source file WITHOUT the `!!` (or before the review
commit, but clean), commit the review-create commit, then add the `!!` via a new
`"<file>" is modified to:` step (composable, mirrors the existing REVIEW.md
modify step) so it surfaces as an added line in `git diff <reviewCommit>`. Add
an "unreferenced reviewer-added `!!` IS harvested" scenario (the `!!`-bearing
file is not in REVIEW.md's chunk refs, yet the diff-based harvest still catches
it). Keep a false-positive guard: a `!!` committed at/before the review commit
(pre-existing) is NOT harvested. `src/Git.test.ts:355-418` — rewrite the
`grepBang` block to the `baseRef` API: commit a baseline, dirty an added `!!`
line, assert it is harvested while a pre-existing `!!` (committed at baseline)
is not; keep the REVIEW.md/TODO.md exclusion test.

## Why no manual strip / git revert (Q3 resolution)

At harvest time (`gatherEvents`) HEAD IS the `review(gtd): create review …`
commit and the reviewer's `!!` additions are **uncommitted working-tree edits**.
The review-process flow then runs its reset (Step 7): `git add TODO.md` →
`git checkout -- .` → `git clean -fd` → `rm REVIEW.md`. `git checkout -- .`
discards **all** tracked source edits wholesale, and `git clean -fd` removes
untracked reviewer files — so the reviewer-added `!!` lines are removed
**mechanically by the existing reset**, with no per-line agent stripping. The
old Step 4.3 strip instruction is therefore redundant in the normal flow, and an
explicit `git revert` is unnecessary (the lines were never committed; there is
nothing to revert). Pre-existing committed `!!` are explicitly ignored per the
user, so they must NOT be stripped anyway. Harvest becomes **read-only**.

**README.md:** update the `!!` harvest description (`README.md:110` area) to the
added-line-since-review-commit semantics.

## Note on this run

Per "older `!!` comments can be ignored", the 12 harvested hits above were
treated as pre-existing noise: NOT pulled in as tasks, NOT stripped. They appear
here only as evidence.

## Resolved

### What is the exact baseline ref + diff command that defines "reviewer-added `!!` lines"?

**Recommendation:** Baseline = the **`review(gtd): create review for <short>`
commit**, exactly what `git.lastReviewCommit()` returns (`src/Git.ts:133-145`,
greps `^review\(gtd\): create review for`). At harvest (`gatherEvents`,
`src/Events.ts:253-273`) `REVIEW.md` is dirty, no raw-feedback commit exists
yet, and HEAD is the review-create commit — so reviewer session edits = the
working-tree changes since that commit. Diff the **working tree against
`lastReviewCommit()`** and keep only `!!` tokens on added (`+`) lines:
`git diff <reviewCommit> -- ':!REVIEW.md' ':!TODO.md'` (no second ref — compares
ref → working tree, picking up uncommitted edits). This replaces the pathspec
(`chunkRefPaths ∪ dirtyPaths`) approach entirely. `git diff <ref>` omits
untracked files, so `git add --intent-to-add` untracked paths first (mirror
`diffHead`, `Git.ts:54-66`) then reset, keeping new untracked reviewer files in
scope.

**Answer:** agree with recommendation

### How does the new line-level harvest map onto the `BangComment` {file, line, text} shape the prompt consumes?

**Recommendation:** Keep the shape identical (`src/Git.ts:27-33`); the prompt
payload (`bangComments`) is unchanged. Compute `line` from diff hunk headers:
parse `@@ -a,b +c,d @@`, take `c` as the new-file start line, increment a
counter for each `+`/context line; when a `+` line matches the `!!` pattern emit
`{file, line: <counter>, text}` using the same text-strip regex already in
`grepBang` (`src/Git.ts:253-256`). Preserves all existing file/line/text
assertions in `Git.test.ts` — only the _source_ of candidates changes
(diff-added vs whole-file grep).

**Answer:** agreed

### Does this replace `grepBang(pathspec)` or add a new method? And how is the reviewer-added `!!` removed from source?

**Recommendation:** Replace it. `grepBang(pathspec)` →
`grepBangAdded(baseRef: string)` (interface decl `Git.ts:24`). Exactly **one**
caller (`Events.ts:272`). Keep `:!REVIEW.md`/`:!TODO.md` exclusions. When
`lastReviewCommit()` is `None`, return `[]` (never whole-tree). Harvest is
**read-only** — it does not mutate source.

**Removal of the added `!!`:** No manual strip and no `git revert` needed. The
reviewer's `!!` are uncommitted working-tree edits at harvest time; the existing
review-process reset (Step 7: `git checkout -- .` discards tracked edits,
`git clean -fd` removes untracked files) wipes them mechanically. The old Step
4.3 "strip the `!!` from source" instruction is redundant and should be dropped.
Pre-existing committed `!!` are ignored per the user, so they are never stripped
anyway. (See "Why no manual strip / git revert" above.)

**Answer:** couldn't we use git revert to remove those lines instead of letting
the agent guess and maybe forget something? — Resolved: even simpler than a
revert. The added `!!` are never committed at harvest time; the existing
`git checkout -- .` / `git clean -fd` reset already removes every reviewer
source edit (including the `!!` lines) with zero per-line agent guessing. Drop
the Step 4.3 strip instruction; the harvest becomes read-only and the reset is
the single mechanical removal point.

### How do the existing `spec-harvest` scenarios and `Git.test.ts` map onto added-line semantics?

**Recommendation:** Rewrite both so the `!!` is introduced **after** the
review-create commit:

- `spec-harvest.feature` — the source file is committed clean (no `!!`)
  at/before the review-create commit; the `!!` is then added as a working-tree
  edit via a new composable `"<file>" is modified to:` step (mirrors the
  existing REVIEW.md modify step). Add an "unreferenced reviewer-added `!!` IS
  harvested" scenario (file not in REVIEW.md chunk refs, still caught by the
  diff). Keep a guard that a `!!` committed at/before the review commit is NOT
  harvested.
- `Git.test.ts` `grepBang` block (`src/Git.test.ts:355-418`) — rewrite to the
  `baseRef` API: commit a baseline, dirty an added `!!`, assert harvested while
  a pre-existing (baseline-committed) `!!` is not; keep the REVIEW.md/TODO.md
  exclusion test.

**Answer:** "scenarios commit the `!!` file **before** the
`review(gtd): create review …` commit": this is a violation of reality. `!!`
comments will always be after review creation. — Corrected: all fixtures now
introduce the `!!` as a working-tree edit **after** the review-create commit,
never before. (The current `spec-harvest.feature` fixtures commit the `!!` in a
`feat:` commit that precedes the review commit — that ordering is wrong and is
what this rewrite fixes.)
