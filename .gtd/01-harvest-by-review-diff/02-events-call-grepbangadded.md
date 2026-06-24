# Switch gatherEvents to grepBangAdded with the review-commit baseline

`gatherEvents` is the ONLY caller of the old `grepBang(pathspec)`. Replace the
`chunkRefPaths ∪ dirtyPaths` pathspec construction with a single call to
`git.grepBangAdded(reviewCommit)`, where the baseline is the
`review(gtd): create review …` commit from `git.lastReviewCommit()`.

## Files

- `src/Events.ts` — the `reviewExists` block (~248-282) and the stale comment
  at ~248-250. The `bangPresent` derivation and the payload spread (~357) stay.

## What to do

Inside `if (reviewExists) { … }`:

- DELETE the pathspec construction:
  - the `chunkRefPaths` `matchAll(/^- \[[ x]\] (\.\/[^\s#]+)/gm)` block,
  - the `dirtyPaths` mapping,
  - the `pathspecSet` / `pathspec` lines,
  - the `git.grepBang(pathspec)` call.
- Replace with:
  - `const reviewCommit = yield* git.lastReviewCommit()`
  - `bangComments = Option.isSome(reviewCommit) ? yield* git.grepBangAdded(reviewCommit.value) : []`
  - keep `bangPresent = bangComments.length > 0`.
- `Option` is already imported (line 2). `git.lastReviewCommit()` already exists
  (`src/Git.ts` ~133-145) and returns `Option.Option<string>`.
- Keep everything else in the block unchanged: `reviewModified`,
  `reviewUnmodified`, reading `reviewContent` (still needed for the base-ref
  parse and `reviewApprovedNoChanges`), the `baseMatch` corruption check, and
  the `reviewApprovedNoChanges` computation.
- Update the stale comment at ~248-250 ("scoped to its chunk-referenced files ∪
  dirty working-tree paths …") to describe the new semantics: harvested only
  when REVIEW.md exists; the `!!` tokens on lines added since the
  `review(gtd): create review …` commit (`lastReviewCommit()`), regardless of
  which files REVIEW.md references; REVIEW.md / TODO.md excluded.
- `reviewContent` may no longer be referenced for the (now-removed) chunkRefs but
  IS still used for `baseMatch` and `onlyReviewDirty`/`reviewApprovedNoChanges` —
  leave it. If `codeEntries` is now unused anywhere, check: it is still used for
  `codeDirty` (line ~215), so leave it. Ensure no unused-variable lint errors
  remain after deleting the pathspec block.

## Acceptance criteria

- [ ] No reference to `grepBang` or any `pathspec`/`chunkRefPaths`/`dirtyPaths`
      construction remains in `src/Events.ts`.
- [ ] `bangComments` is sourced from `git.grepBangAdded(reviewCommit.value)` when
      `lastReviewCommit()` is `Some`, else `[]`.
- [ ] `bangPresent` and the `...(bangComments.length > 0 ? { bangComments } : {})`
      payload spread are unchanged.
- [ ] The stale comment (~248-250) is updated to the added-line-since-review
      semantics.
- [ ] `npm run typecheck` and `npm run test` pass.

## Constraints / edge cases

- File-disjoint from the Git.ts task: do NOT touch `src/Git.ts` or
  `src/Git.test.ts`. This task depends on `grepBangAdded` existing — it lands in
  the SAME package so the suite compiles atomically.
- When `lastReviewCommit()` is `None`, harvest nothing (never whole-tree). In the
  normal flow REVIEW.md only exists alongside a review-create commit, so this is
  defensive.
