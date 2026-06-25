# Review: 28766d6

<!-- base: 28766d6d7ca8c3c57770d9fad1e46e357ac9cdfd -->

## Fix review-process commit prefixes

Both record and synthesize commits from the `review-process` state used
`docs(review):` prefix, which `isGtdWorkflowSubject` does not recognize. This
caused an infinite review loop: each gtd run saw the synthesize commit as a real
code change, generated a new `REVIEW.md`, and repeated.

The fix changes both commit messages to `chore(gtd):`, which is already in the
recognized prefix set. Prompt, Git implementation, and both tests are updated
consistently.

- [x] ./src/Git.ts#379
- [x] ./src/prompts/review-process.md#38
- [x] ./src/Git.test.ts#338
- [x] ./src/Prompt.test.ts#62

## Machine.ts formatting cleanups

Three style fixes applied verbatim from the previous review: removed the extra
blank line between `EdgeAction` and `GtdContext`, and reformatted
`isFixTestsLoop` and `packageCommitMsg` from single long lines to multi-line for
consistency with surrounding guards.

- [x] ./src/Machine.ts#127

## Backward-compat gap in isGtdWorkflowSubject

`isGtdWorkflowSubject` matches `plan(gtd):`, `review(gtd):`, and `chore(gtd):`,
but NOT `docs(review):`. Repos that already have old-format commits in history
(like this one —
`9d0112f docs(review): synthesize TODO.md from review feedback`) will continue
to surface those commits in review diffs on every cycle. The pattern should also
cover `docs(review):` for backward compatibility.

!! Add `docs(review):` to the `isGtdWorkflowSubject` regex in `src/Events.ts`
line 126:

```ts
const isGtdWorkflowSubject = (s: string) =>
  /^(?:plan|review|chore)\(gtd\):|^docs\(review\):/.test(s)
```
