# Slim `review-process.md` to a synthesis-only prompt (+ update Prompt.test)

Now that `main.ts` (task 01 of this package) does the commit / capture / revert /
close at the edge, the agent's only remaining job is to turn the INJECTED diff
into a fresh `TODO.md`. Strip all git machinery and `!!` mentions.

## What to do (`src/prompts/review-process.md`)

Rewrite to a slim prompt whose ONLY instructions are:
- The review feedback is provided to you as an injected diff below (rendered by
  the edge). The diff IS the feedback:
  - REVIEW.md prose hunks = **global** feedback.
  - Source-file comment additions = **local** feedback.
  - Source-file code changes = **suggestions** that must be independently
    verified and implemented properly, NOT applied verbatim.
- Synthesize a clear, actionable `TODO.md` in the project root from that diff
  (reference file/function names from the REVIEW.md explanations).
- Run `node scripts/gtd.js format TODO.md` (same `scripts/gtd.js` path used to
  get this prompt).
- Commit ONLY the synthesized `TODO.md` (the agent runs no other git work).
- Recovery note: "If you lose this diff, recover it with `git show <record-sha>`"
  (the edge injects the record-sha).

REMOVE entirely:
- Step 2 (read working diff), Steps 5–7 (`git add`/commit/`git show`/
  `git revert`/`git rm`/close machinery) and the Step-7 FAILURE BRANCH — all
  moved to the edge.
- Every `!!` mention.

The agent must NOT be told to run `git revert`, `git rm REVIEW.md`, the record
commit, or the close commit — those no longer happen in the prompt.

## Tests (same task — `src/Prompt.test.ts`)

- Update the existing `"review-process prompt instructs to format TODO.md and use
  git revert"` case (~line 57): it must now assert the slim prompt instructs
  formatting + committing `TODO.md` and DOES **NOT** contain `git revert` /
  `docs(review): record raw feedback` / `chore(gtd): close approved review`
  (those moved to the edge). Rename the case accordingly.
- Keep the package-04 `review-process` override-rendering test green (it builds
  with the override and checks the injected diff + recordSha).

## Acceptance criteria

- [ ] `review-process.md` contains no `git revert`, no record/close/`git rm`
      machinery, no FAILURE BRANCH, no `!!`.
- [ ] It instructs: read the injected diff, synthesize TODO.md (global/local/
      suggestion taxonomy), `format`, commit only TODO.md, recovery via
      `git show <record-sha>`.
- [ ] `src/Prompt.test.ts` review-process assertion updated to the slim prompt;
      all Prompt.test cases green.
- [ ] `npm run test` green.

## Files

- `src/prompts/review-process.md`
- `src/Prompt.test.ts`

## Constraints / edge cases

- DEPENDS ON package 04 (override rendering) and this package's task 01 (edge does
  the git work). File-disjoint from `main.ts` (task 01).
- `review-process` keeps its `auto-advance` tag (set in `Machine.ts`); the slim
  prompt should read naturally as the precursor to grilling/planning the new
  TODO.md.
