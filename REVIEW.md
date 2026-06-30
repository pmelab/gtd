# Review: dfb18b8

<!-- base: dfb18b8171ddc1fb981f070836cda10df64dfee9 -->

## Review base: prefer more-recent ancestor

The Clean-state review base now considers two candidates — the merge-base with
the default branch and the last `REVIEW.md` deletion — and picks whichever is
the more recent ancestor of HEAD (via the new `git.isAncestor`). This makes a
completed branch review advance past `gtd: done` instead of re-reviewing the
whole branch. Backed by a new `isAncestor` git op (`merge-base --is-ancestor`,
returns false on any error).

- [ ] ./src/Events.ts#213
- [ ] ./src/Events.ts#228
- [ ] ./src/Events.ts#237
- [ ] ./src/Git.ts#14
- [ ] ./src/Git.ts#132

## Emit review base hash into clean prompt

The clean prompt gains a `Review base: <hash>` line and labels the diff heading
with the literal hash (falling back to `<base>` when absent), so the agent can
write the `# Review: <short-hash>` heading and `<!-- base: <full-hash> -->`
marker. New test asserts the literal hash reaches the prompt.

- [ ] ./src/Prompt.ts#198
- [ ] ./src/Prompt.test.ts#308

## New REVIEW.md format spec

The clean-prompt template defines the new format: hash heading, base marker,
`- [ ]` checkboxes as non-gating navigational aids, and the open-on-top /
`## Resolved`-at-bottom convention.

- [ ] ./src/prompts/clean.md#19
- [ ] ./src/prompts/clean.md#41
- [ ] ./src/prompts/clean.md#48

## Cover new format and branch-review settling

Two integration scenarios: a committed REVIEW.md with the base marker and
unchecked boxes still finishes as `gtd: done` (boxes never gate), and a
completed branch review settles in Idle rather than re-reviewing.

- [ ] ./tests/integration/features/review.feature#60
- [ ] ./tests/integration/features/review.feature#121

## Document the new format

README and STATES.md describe the new review base logic, the hash heading + base
marker, and the informational (never-enforced) checkboxes.

- [ ] ./README.md#63
- [ ] ./README.md#240
- [ ] ./STATES.md#287

## Resolved

<!-- resolved items move here as the user works through the review -->
