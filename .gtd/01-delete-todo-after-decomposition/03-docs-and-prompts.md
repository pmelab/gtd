# Task: Update prompts and docs for the post-decomposition TODO.md deletion

Reflect the new lifecycle (TODO.md deleted at the first Building dispatch,
committed under `gtd: planning`) in the prompts and human-facing docs.

## Files

- `src/prompts/decompose.md` (edit)
- `src/prompts/building.md` (edit — one-line note only, optional but preferred)
- `STATES.md` (edit)
- `README.md` (edit)

Do **not** touch any `.ts` files or `src/prompts/clean.md`.

## What to build

### `src/prompts/decompose.md`

In the "After the subagent completes" section, replace the sentence
"Leave `TODO.md` in place — it is the plan of record while the packages are
built." with a note that `TODO.md` is deleted once decomposition finishes
(its full history is preserved in git, recorded in the `gtd: planning` commit at
the first Building turn) and that build subagents receive only their concrete
`.gtd/` task files. Keep the "Leave every change uncommitted" guidance intact.

### `src/prompts/building.md`

Verify the existing "Context: the task content only" / "do not browse `.gtd/`"
guidance. Optionally add one line noting `TODO.md` is intentionally absent during
the build loop (no behavioral change). Skip if it does not fit cleanly.

### `STATES.md`

1. **Building section** (~line 178): document that the first Building dispatch
   deletes `TODO.md` when HEAD is `gtd: planning` and `TODO.md` is present —
   committed under `gtd: planning` (HEAD prefix unchanged), firing at most once.

2. **Close package section** (~line 270): remove the paragraph
   "When it was the last package, also remove TODO.md so the next run falls
   through rule 6 (TODO.md present → Grilling) to rule 7 (Clean/Idle) instead of
   re-entering the Grilling loop." (now obsolete — TODO.md is gone before any
   package closes).

3. **Legal-coexistence note** (~line 96): change the `.gtd`+TODO.md coexistence
   note to state it is legal only **during Planning**, not during the build loop
   (by the first Building turn TODO.md is deleted).

### `README.md`

1. Update the TODO.md lifecycle prose (around lines 310-322, the Capture/Answer
   walkthrough) so the state-flow reflects that after Planning decomposes the
   plan, `TODO.md` is deleted at the first Building turn (preserved in git).
2. Update the legal-coexistence note (~line 193: "Legal coexistence: `.gtd` +
   TODO.md (plan kept alongside packages during build)") to say it is legal only
   during Planning, not the build loop.
3. If the Building / Close-package rows of the state table (~lines 238-242 area
   and below) reference TODO.md retention/removal at close, align them with the
   new lifecycle.

Note: the `## Resolved` references in README (~lines 489-492) and the
`## Open Questions` graveyard are about **TODO.md grilling Q&A**, NOT the
REVIEW.md format — leave them unchanged.

## Acceptance criteria

- [ ] `decompose.md` no longer says "Leave TODO.md in place" and documents post-decomposition deletion (preserved in git)
- [ ] `STATES.md` Building section documents the first-Building TODO.md deletion under `gtd: planning`
- [ ] `STATES.md` Close-package section no longer mentions removing TODO.md / rule 6→7
- [ ] `STATES.md` and `README.md` legal-coexistence notes scope `.gtd`+TODO.md to Planning only
- [ ] `README.md` TODO.md lifecycle prose reflects deletion at the first Building turn
- [ ] No changes to `src/prompts/clean.md` or the TODO.md `## Resolved`/`## Open Questions` Q&A docs
