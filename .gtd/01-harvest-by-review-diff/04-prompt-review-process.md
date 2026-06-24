# Reword review-process.md Step 4.3 for read-only added-line harvest

Update the prompt's description of where `!!` follow-up comments come from, and
DROP the now-redundant "strip from source" instruction (the Step 7 reset removes
the reviewer-added `!!` lines mechanically).

## Files

- `src/prompts/review-process.md` — Step 4.3 (lines ~42-49).

## What to do

In the `**`!!` follow-up comments in the reviewed code**` bullet (Step 4.3):

- Reword the source description from
  "gtd has already harvested `!!` comments from the files this `REVIEW.md`
  covers (its chunk references) plus the dirty working tree" to:
  "gtd has already harvested the reviewer-added `!!` comments — the `!!` tokens
  on lines added since the `review(gtd): create review …` commit — regardless of
  which files `REVIEW.md` references, and inlined them in the Context above under
  '`!!` follow-up comments'."
- Keep the verbatim/intent-not-parsed guidance and the "`TODO:` comments are not
  harvested" sentence.
- DELETE the trailing sentence
  `After capturing, strip the `!!` comments from the source.` — the harvest is
  read-only; the Step 7 reset (`git checkout -- .` / `git clean -fd`) already
  removes the reviewer's uncommitted `!!` lines, so no per-line stripping is
  needed.

## Acceptance criteria

- [ ] Step 4.3 describes the harvest source as `!!` on lines added since the
      `review(gtd): create review …` commit, regardless of file membership.
- [ ] The "strip the `!!` comments from the source" sentence is removed.
- [ ] No other step references the old "chunk references plus dirty working tree"
      scoping for `!!`.

## Constraints / edge cases

- File-disjoint: touches ONLY `src/prompts/review-process.md`. (This prompt is
  bundled into `scripts/gtd.js`; package 02 rebuilds the bundle so the change
  ships — do NOT rebuild here.)
- Do not alter Step 7's reset wording — it is the mechanical removal point and
  stays as-is.
