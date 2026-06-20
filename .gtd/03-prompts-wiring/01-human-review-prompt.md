# Add the human-review prompt

Create `src/prompts/human-review.md`: the prompt for the new terminal
`human-review` step. It generates REVIEW.md in the exact same format and commit
message as the manual `review-create` step, then STOPs (no auto-advance).

## Files

- `src/prompts/human-review.md` (new)
- Reference (do not modify): `src/prompts/review-create.md`

## Content requirements

The body must be functionally identical to `review-create.md` so the existing
`review-process` follow-up handles it with zero changes. Reuse the same:

- Heading `# Review: <short-hash>` (first 7 chars of the base ref).
- Machine-readable marker `<!-- base: <full-hash> -->` (full SHA of the base).
- The "parse refDiff → group hunks semantically → write REVIEW.md → format →
  commit" steps.
- Format command: `node scripts/gtd.js format REVIEW.md` (per AGENTS.md, run
  `gtd format` after editing REVIEW.md; match the path style used in
  `review-create.md`).
- Commit message: `review(gtd): create review for <short-hash>` (this is what
  `lastReviewCommit` greps for — it must match exactly).
- End with **STOP** — do not re-run gtd; the user reviews/edits REVIEW.md.

Add a short opening sentence clarifying this is the post-verify auto-generated
review: the working tree is clean, tests passed, and `human-review` is producing
REVIEW.md for the un-reviewed commits since the computed base. Context provides
`refDiff` (output of `git diff <base> HEAD`) exactly as `review-create` expects.

## Avoiding duplication (preferred)

`review-create.md` and `human-review.md` share almost their entire body. Per the
existing `partials/` pattern (`auto-advance.md`), extract the shared
instructions into `src/prompts/partials/review-body.md` and have BOTH
`review-create.md` and `human-review.md` reference/import it. Check how partials
are composed: `auto-advance` is imported in `Prompt.ts` and appended
programmatically — there is no in-markdown include mechanism. So either:

- (a) Import a shared partial in `Prompt.ts` and concatenate it for both
  branches, OR
- (b) Keep the two prompt files separate with duplicated body but a single thin
  differing intro.

Choose (a) only if it stays simple; otherwise (b) is acceptable. Do NOT
over-engineer an include system. If choosing (b), keep the format/marker/commit
strings byte-identical to `review-create.md` so detection stays consistent.

## Constraints

- Commit subject prefix MUST be exactly `review(gtd): create review for ` —
  verified against `lastReviewCommit`'s grep (package 01).
- `<!-- base: <full-hash> -->` marker format MUST match the regex in `State.ts`
  review-process detection: `/<!--\s*base:\s*([a-f0-9]+)\s*-->/`.
- Prompt is terminal: it must instruct STOP and must NOT instruct re-running
  gtd.

## Acceptance criteria

- [ ] `src/prompts/human-review.md` exists.
- [ ] Produces REVIEW.md with `# Review: <short-hash>` and a valid
      `<!-- base: <full-hash> -->` marker.
- [ ] Commit message is `review(gtd): create review for <short-hash>`.
- [ ] Ends with STOP; contains no "re-run gtd" instruction.
- [ ] If a shared partial was extracted, `review-create.md` still renders
      identically (existing `review.feature` scenarios must pass).
