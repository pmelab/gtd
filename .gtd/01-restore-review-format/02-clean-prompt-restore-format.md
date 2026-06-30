# Task: Restore the old REVIEW.md output format in clean.md

Rewrite the "Write `REVIEW.md`" format block in `src/prompts/clean.md` to the
old `human-review.md` format — hash marker + per-hunk checkboxes — plus the
open-on-top / resolved-at-bottom question convention. No enforcement language.

## What to build

In `src/prompts/clean.md`, change the format block (step 3, currently L16-38)
so the authored REVIEW.md uses:

- Heading `# Review: <short-hash>` — first 7 chars of the base hash.
- Marker line `<!-- base: <full-hash> -->` — full SHA of the review base. The
  agent reads the base hash from the `Review base:` line / diff label that
  task 01 adds to the prompt context.
- Per-hunk **checkboxes**: `- [ ] ./path/to/file.ts#42` (was plain `- ` bullets).

Keep unchanged from the current prompt:

- Semantic hunk grouping (fewest navigable chunks, clustered by concern).
- Relative `./`-prefixed pointers; line numbers are drift hints, not authoritative.
- Chunk titles = short imperative phrases (≤ 6 words).
- The `gtd format REVIEW.md` normalize step.
- Leaving REVIEW.md **uncommitted**.
- The existing re-run / approve / request-changes wrap-up text (L43-46).

### Question handling — open-on-top / resolved-at-bottom

Mirror `src/prompts/grilling.md` (its `## Resolved` discipline, L29-32 and
L44-47). Spell out explicitly in the format block + rules:

- **Open/unresolved review comments and questions go at the top** of REVIEW.md,
  so the human sees outstanding items first.
- **Resolved/answered items are retained at the bottom** in a trailing section
  (mirror grilling's `## Resolved`) — kept for the record, never deleted.
- As the user resolves a comment it **moves** from the top region down into the
  retained-at-bottom section rather than being removed.

### Do NOT

- Do **not** add any "you must check all boxes" / "all boxes must be checked"
  language. The checkboxes are navigational aids for the human, **not a gate**.
- Do **not** revive the old `review(gtd): ...` commit message — REVIEW.md stays
  uncommitted; the edge commits it as `gtd: awaiting review` (unchanged).

## Acceptance criteria

- [ ] Format example shows `# Review: <short-hash>` heading
- [ ] Format example shows `<!-- base: <full-hash> -->` marker line
- [ ] Per-hunk pointers are `- [ ]` checkboxes
- [ ] Open-on-top / resolved-at-bottom convention spelled out, referencing the
      same discipline as grilling.md's `## Resolved`
- [ ] No enforcement / "must check" language anywhere in the file
- [ ] Semantic grouping, `./` pointers, drift-hint note, ≤6-word titles,
      `gtd format REVIEW.md` step, and uncommitted instruction all retained
- [ ] `{{MODEL}}` placeholder usage (L9) left intact

## Files

- Edit: `/Users/pmelab/Code/gtd/gtd/src/prompts/clean.md`
- Reference (do not edit): `/Users/pmelab/Code/gtd/gtd/src/prompts/grilling.md`

## Constraints

- File-disjoint with all other tasks. You own `src/prompts/clean.md` only.
- The integration scenario `clean renders the clean section` asserts the prompt
  contains the substring ``Create `REVIEW.md` for the finished work`` (heading at
  L1) — keep that heading text.
