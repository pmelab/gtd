# Rewrite `review-process.md`: reference-commit + mechanical revert teardown

Replace the agent-driven reset (Step 7 `git checkout -- .` / `git clean -fd`)
with a deterministic, artifact-free teardown: commit the whole working tree
verbatim as reference commit "x", synthesize TODO.md from its diff, then
`git revert` "x", remove REVIEW.md, and end with the recognized close anchor.

This task owns `src/prompts/review-process.md` exclusively.

## Files (exclusive to this task)

- `src/prompts/review-process.md`

## What to do

1. **Step 4 — two feedback sources, no `!!` injection.** Delete Step 4 item 3
   (~42-49, the "`!!` follow-up comments in the reviewed code … inlined in the
   Context above" paragraph). gtd no longer harvests/injects per-comment `!!`
   text. Reframe Step 4 to two sources, BOTH read from the commit-"x" diff:
   (1) REVIEW.md comments, (2) source edits (incl. any `!!` lines, which are just
   hunks in the diff). State that the single source of all feedback is the diff
   of reference commit "x" (Step 6/7), not an injected Context section.

2. **Step 6 — commit "x" verbatim.** Read the `<!-- base: … -->` ref from
   REVIEW.md (already read in Step 1). Then:
   ```sh
   git add -A
   git commit -m "docs(review): record raw feedback for <base>"
   ```
   This captures source edits + `!!` + REVIEW.md edits + untracked files together
   (Q2: code is NOT pre-committed during review, so the whole dirty tree is here).
   Keep the existing "commit verbatim, do not modify content" guidance.

3. **Step 7 — synthesize TODO.md from the commit-"x" diff.** `git show <x>` (or
   `git diff <x>^ <x>`) is the single source of all feedback (REVIEW.md comments,
   source edits, `!!` lines are all hunks). Compose `TODO.md` in the project root,
   run `node scripts/gtd.js format TODO.md` (same `scripts/gtd.js` path used to
   get this prompt), then `git add TODO.md && git commit` (e.g.
   `-m "docs(review): synthesize TODO.md from review feedback"`).

4. **Step 8 — mechanical teardown (REPLACES the old reset Step 7 and old commit
   Step 8 entirely).** In order:
   - `git revert --no-edit <x>` to undo ALL reviewer changes.
   - **Failure branch (explicit):** on a revert CONFLICT / non-clean exit, run
     `git revert --abort`, then STOP and escalate to the human. Do NOT leave a
     half-reverted tree. Make this an unmistakable failure branch in the prose.
   - On success: if `REVIEW.md` is still tracked, `git rm REVIEW.md`.
   - Final anchor commit — extract `<short-sha>` as the first 7 chars of the
     `<!-- base: … -->` full hash, then:
     ```sh
     git commit -m "chore(gtd): close approved review for <short-sha>"
     ```
     This subject MUST match the `lastCloseCommit` grep
     `^chore\(gtd\): close approved review for` exactly so the loop terminates
     (frontier-at-HEAD short-circuit).
   - Remove the old `git checkout -- .` / `git clean -fd` / `rm REVIEW.md` reset
     sequence and the old `docs(review): process review feedback into TODO.md`
     commit step entirely.

## Constraints

- The teardown is entirely shell in this prompt (Q3) — assume the agent runs the
  git commands; no `GitOperations` calls.
- Do NOT reference an injected "`!!` follow-up comments" Context section anywhere.
- Keep Steps 1–3 and Step 5 (compose) / 5b (format) coherent with the new flow;
  it is fine to renumber as long as the flow is: read → commit "x" → synthesize
  TODO.md → revert teardown → close anchor.
- The e2e features in this same package assert these exact strings; keep them
  consistent: `# Process Review Feedback` (title), `docs(review): record raw
  feedback for`, `git revert --no-edit`, `chore(gtd): close approved review`,
  `format TODO.md`.

## Acceptance criteria

- [ ] No `git checkout -- .` / `git clean -fd` reset sequence remains.
- [ ] No `docs(review): process review feedback into TODO.md` commit remains.
- [ ] Step "commit x" uses `git add -A` + `docs(review): record raw feedback for <base>`.
- [ ] Synthesis reads `git show <x>` / `git diff <x>^ <x>` and runs
      `node scripts/gtd.js format TODO.md`.
- [ ] Teardown runs `git revert --no-edit <x>` with an explicit
      conflict→`git revert --abort`+STOP+escalate branch.
- [ ] Teardown ends with `chore(gtd): close approved review for <short-sha>`
      matching `^chore\(gtd\): close approved review for`.
- [ ] No reference to an injected `!!` follow-up comments Context section.
