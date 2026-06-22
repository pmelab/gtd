# Retain user-provided information as direct commits

Any information the **user** authored must land as a real commit in git history
before gtd transforms or discards it. Three sources, each with a current loss
point:

1. **`TODO.md`** (user's plan + its Q&A history) — `decompose` deletes it and
   commits only `.gtd/` (`src/prompts/decompose.md:59`). A `TODO.md` that was
   never committed (e.g. a fresh one routed straight to `decompose`) disappears
   entirely.
2. **In-code feedback** (reviewer's source edits + `TODO:` markers) —
   `review-process` runs `git checkout -- .` + `git clean -fd`
   (`src/prompts/review-process.md:60-76`), discarding all reviewer source
   edits.
3. **`REVIEW.md` feedback** (comments / non-checkbox annotations) —
   `review-process` deletes `REVIEW.md`, so the reviewer's written feedback only
   survives as the tool's own paraphrase in the synthesized `TODO.md`.

"Pure check-offs" are already excluded by construction: `close-review`
(`Machine.ts:141`) intercepts forward-only checkbox ticks before
`review-process` runs, so `review-process` is only reached when real feedback
exists.

No state-machine change is required: commit subjects are classified only by the
`isFixGtd` regex (`src/Events.ts:163`), and the new `docs(...)` commits fold as
ordinary commits and are never selected as a review base. The work is prompt
edits plus tests. (The decomposition should still verify this assumption.)

## Plan

### Slice A — `review-process` records raw feedback first

Edit `src/prompts/review-process.md`. Before the reset sequence (current Step
6), insert a step that commits the reviewer's dirty tree **verbatim** — the
annotated `REVIEW.md` (including its checkboxes), all source edits, and any
in-place `TODO:` markers — as:

```
docs(review): record raw feedback for <base>
```

using the base ref noted at the top of `REVIEW.md`. The existing reset +
synthesis then runs on top, producing the unchanged
`docs(review): process review feedback into TODO.md` commit. History thus keeps
both the raw artifact and the actionable distillation; the second commit
reverting the source edits is acceptable churn.

### Slice B — `decompose` records `TODO.md` before deleting it

Edit `src/prompts/decompose.md`. Before deleting `TODO.md`, if it is **not
already recorded in `HEAD`** (untracked, or differs from `HEAD`), commit it as:

```
docs(plan): record TODO.md
```

Then delete it and commit `.gtd/` as before. This preserves the user's plan and
its full Q&A history (`## Open Questions` / `## Answered Questions`) — covering
the Q&A-retention concern — for the direct-to-`decompose` path. In the normal
flow `new-todo`/`modified-todo` already commit `TODO.md`, so the guard is a
no-op there.

### Tests & docs

- Add cucumber scenarios (`tests/integration/features/`) asserting the emitted
  prompts carry the new instructions — `review-process` stdout mentions
  recording raw feedback before reset; `decompose` stdout mentions recording
  `TODO.md` before deletion. Follow the existing `review.feature` patterns and
  composable, content-revealing `Given` steps.
- Update `README.md` so the review / decompose / states sections describe the
  retain-as-commit behavior.

## Answered Questions

### Should raw review feedback be a dedicated commit before the processing commit?

**Recommendation:** Yes — commit the reviewer's dirty tree verbatim as
`docs(review): record raw feedback for <base>`, then run the existing reset +
synthesis on top.

**Answer:** yes

### Should `decompose` commit `TODO.md` before deleting it?

**Recommendation:** Yes, but only when it isn't already in `HEAD`. Commit as
`docs(plan): record TODO.md`, then delete and commit `.gtd/`.

**Answer:** yes

### In the raw-feedback commit, retain `REVIEW.md` verbatim or strip checkbox lines?

**Recommendation:** Retain verbatim, including checkboxes — it's the user's
artifact; the pure-check-off case never reaches here anyway.

**Answer:** yes

### Is scope limited to `decompose` and `review-process`?

**Recommendation:** Yes. Those are the only states that delete or reset
user-authored content.

**Answer:** Q&A steps in `TODO.md` should also be retained — and they are, via
Slice B committing `TODO.md` (with its Open/Answered Questions) before
`decompose` deletes it.
