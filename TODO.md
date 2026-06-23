---
status: grilling
---

# Harvest `!!` review comments by review-session diff, not file membership

Review feedback on the Bug 2 (`!!` harvest scoping) change. The reviewer's note,
recorded verbatim on the "Bug 2: scope `!!` harvesting to the reviewed files"
chunk of `REVIEW.md`:

> all comments have to be addressed, also potentially in other files, not
> referenced in REVIEW.md. but it should be clear from the previous git commit
> what was an actual review comment. older "!!" comments can be ignored.

## Open Questions

### What is the exact baseline ref + diff command that defines "reviewer-added `!!` lines"?

**Recommendation:** Baseline = the **`review(gtd): create review for <short>`
commit**, which is exactly what `git.lastReviewCommit()` already returns
(`src/Git.ts:133-145`, greps `^review\(gtd\): create review for`). I verified
the live loop ordering against this session's history (`git log`):

```
448733f docs(review): process review feedback into TODO.md   <- written AFTER harvest
613cd45 docs(review): record raw feedback for d78b6fc...      <- written AFTER harvest
e44f86a review(gtd): create review for d78b6fc                <- HEAD at harvest time
```

When `gatherEvents` runs the harvest (`src/Events.ts:254-272`), `REVIEW.md`
exists and is **dirty** (modified), no raw-feedback commit exists yet, and HEAD
is the `review(gtd): create review …` commit. So the reviewer's session edits =
the working-tree changes since that commit. The harvest must therefore diff the
**working tree against `lastReviewCommit()`** and keep only `!!` tokens on added
(`+`) lines:

```
git diff <reviewCommit> -- ':!REVIEW.md' ':!TODO.md'
```

(no `HEAD` second arg — `git diff <ref>` compares ref → working tree, which is
what we want; it picks up the reviewer's uncommitted edits). I confirmed
`git diff <ref>` against a dirty tree surfaces the reviewer's new lines, and
that filtering `+` lines through the existing `(//|#|<!--)[[:space:]]*!!`
pattern isolates added `!!` from pre-existing ones (tested in /tmp). This
**replaces** the pathspec (`chunkRefPaths ∪ dirtyPaths`) approach entirely —
file membership is no longer the axis; the diff itself is unrestricted by file,
so a reviewer `!!` in a file NOT referenced by REVIEW.md is still caught, and a
pre-existing `!!` in a referenced file is dropped.

Note: `git diff <ref>` does not include **untracked** new files. Reviewers can
add `!!` in a brand-new untracked file. Recommendation: mirror `diffHead`'s
existing trick (`src/Git.ts:54-66`) — `git add --intent-to-add` the untracked
paths first so they appear in the diff as all-`+` lines, then reset. This keeps
untracked reviewer files in scope without a whole-tree grep.

<!-- user answers here -->

### How does the new line-level harvest map onto the `BangComment` {file, line, text} shape the prompt consumes?

**Recommendation:** Keep the shape identical (`src/Git.ts:27-33`); the prompt
(`review-process.md` Step 4.3) and `Events.ts` payload (`bangComments`) are
unchanged. Compute `line` from diff hunk headers: parse `@@ -a,b +c,d @@`, take
`c` as the new-file start line, and increment a counter for every `+`/context
line in the hunk; when a `+` line matches the `!!` pattern, emit
`{file, line: <counter>, text}` with the same text-stripping regex already in
`grepBang` (`src/Git.ts:253-256`). I verified hunk headers give the new-file
start (`@@ -1,2 +1,4 @@`) and added lines follow in order. This preserves all
existing assertions in `Git.test.ts` (file/line/text) — only the _source_ of the
candidates changes (diff-added vs whole-file grep).

<!-- user answers here -->

### Does this replace `grepBang(pathspec)` or add a new method? And how does stripping (Step 4.3) stay limited to added lines?

**Recommendation:** Replace it. Rename `grepBang(pathspec)` →
`grepBangAdded(baseRef)` (or keep the name, change the signature to take a
`baseRef: string`). There is exactly **one** caller (`Events.ts:272`, confirmed
via grep), so the blast radius is small. The `:!REVIEW.md`/`:!TODO.md`
exclusions stay (as `git diff -- :!…` pathspecs). Empty/no-baseline fallback:
when `lastReviewCommit()` is `None`, return `[]` (never whole-tree) — same guard
as today's empty-pathspec early return (`src/Git.ts:231`).

**Stripping:** Step 4.3 of `review-process.md` tells the agent to strip
harvested `!!` from source after capturing. Today it strips by matching the
comment text. Because the harvested set is now _exactly the reviewer-added
lines_, the agent should strip only those `{file, line}` locations —
pre-existing `!!` (gtd's docs/fixtures) are never in `bangComments`, so they are
never stripped. Recommendation: tighten the prompt wording to "strip only the
`!!` comments listed in the harvested set (each identified by file + line),
leaving any other `!!` in the tree untouched." This is the corruption fix from
the original Bug 2 motivation.

<!-- user answers here -->

### How do the existing `spec-harvest` scenarios and `Git.test.ts` map onto added-line semantics?

**Recommendation:**

- `spec-harvest.feature` scenarios commit the `!!` file **before** the
  `review(gtd): create review …` commit. Under added-line semantics, those `!!`
  are NOT "added since the review commit" → they would no longer harvest. The
  scenarios must be **rewritten** so the `!!` is introduced as a working-tree
  edit _after_ the review-create commit (i.e. modify the source file in the same
  step that modifies REVIEW.md), matching how a real reviewer adds it. The
  composable Given steps (per AGENTS.md) likely need a new
  `"<file>" is modified to:` step for source files (analogous to the existing
  REVIEW.md one) so the `!!` lands as a dirty working-tree change.
- The "unreferenced, non-dirty file is NOT harvested" scenario
  (`spec-harvest.feature:104-140`) now passes for a _different, stronger_ reason
  (the `!!` predates the review commit, so it's pre-existing) — keep it, it
  still guards the false-positive case. Add the inverse: a reviewer-added `!!`
  in an **unreferenced** file IS harvested.
- `Git.test.ts` `grepBang` describe block (`src/Git.test.ts:355-418`) tests the
  pathspec API; rewrite to the `baseRef` API: commit a baseline, then
  write/commit or dirty an added `!!` line and assert it is harvested while a
  pre-existing `!!` (committed at baseline) is not. Keep the REVIEW.md/TODO.md
  exclusion test.

<!-- user answers here -->

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
of file. Pre-existing (`older`) `!!` anywhere are ignored: never harvested,
never stripped.

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

**`src/prompts/review-process.md` (Step 4.3, lines 42-49):** reword to say the
harvested set is the reviewer-added `!!` (by file+line) and that stripping must
touch only those lines, never other `!!` in the tree.

**Tests:** `tests/integration/features/spec-harvest.feature` — rewrite scenarios
so `!!` is a working-tree edit after the review-create commit; add a step to
dirty/modify a source file; add an "unreferenced reviewer-added `!!` IS
harvested" scenario and keep the false-positive guard. `src/Git.test.ts:355-418`
— rewrite `grepBang` block to the `baseRef` API.

**README.md:** update the `!!` harvest description (`README.md:110` area) to the
added-line-since-review-commit semantics.

## Note on this run

Per "older `!!` comments can be ignored", the 12 harvested hits above were
treated as pre-existing noise: NOT pulled in as tasks, NOT stripped. They appear
here only as evidence.

## Resolved
