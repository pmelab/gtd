## Open Questions

### Does a footnote that only praises still dead-end a refactor-review round?

Line notes reach the triage judge, so a praise note signs off. Footnotes reach
no judge, so a footnote-only round with no `.gtd/REFACTOR.md` is refused
whatever it says, and `gtd abandon` is the only exit.

- [ ] Refuse every footnote-only round that writes no `.gtd/REFACTOR.md`, as
      sketched
  - no judge call, smallest build
  - **a "looks good" footnote throws away the naive pass, the refactor and its
    review**
- [x] Judge footnotes like line notes; refuse only when one is judged `edit`
  - praise and question footnotes sign off, matching line notes
  - one more judge question per footnote; the triage judge must learn footnote
    anchors
- [ ] _your answer_

## Concerns

Source: the sketch in `.gtd/TODO.md`, "PR 390 round 2", items 1–8. Ordered so
each concern lands green on its own; kit and prompt fixes first, docs last.

### 1. Refactor collecting turn may reply in `.gtd/REVIEW.md` threads — TECHNICAL

**The refactor collecting prompt forbids replying in `.gtd/REVIEW.md`, but the
review kit's in-gate conversation calls that same turn while the file is open
and then requires an `- A:` reply.** Any `- H:` thread at the refactor review
gate therefore refuses the turn.

- Allow exactly one `- A:` reply per waiting thread, as the feature variant
  does; drop the "already closed, do not reply" line
- Keep the end-of-round case working: there the file is closed before
  collecting, and a reply must not recreate it
- A reply-only turn must not trip the `refactor-feedback` "unmatched" refusal
- Cover with a `@inmem` scenario in
  `src/workflows/feature/refactor-review.feature`: a thread question at the
  refactor gate gets an answer and rests at the gate again

### 2. Footnote-only refactor round with no `.gtd/REFACTOR.md` refuses — PRODUCT

**Today a refactor-review round carrying only footnotes reaches the kit's
no-line-notes path with nothing marked as requested, so a collecting turn that
writes nothing silently signs off.** The sketch says it must refuse, like an
`edit` note or a hand-edit does.

- Pass the round's footnotes as requested items into the `dropped` check
- The `refactor-feedback` refusal names each dropped footnote by its anchor
- Scope follows the open question above: every footnote, or only footnotes
  judged `edit`
- The feature review is untouched: it has no `dropped` refusal

### 3. The `dropped` refusal lists edit notes only — TECHNICAL

**On a hand-edit round the refusal lists every review note of the round, praise
and questions included.** It must name only what asked for a change.

- `editNotes` path already passes edit notes only; the hand-edit path passes all
  notes untriaged
- **The hand-edit path runs no triage, so it has no verdicts to filter by** —
  the next phase picks between triaging there or listing hand-edited paths (plus
  footnotes, per concern 2) only
- Update `docs/configuration.md`'s "naming every left-out note" to match

### 4. Refactor review-tail fix prompts name the strays and ban tests — TECHNICAL

**The fix turns inside `refactor.build.*` reuse the feature's prompts, which
never say the guard will refuse any path outside the strays, any test file, or
any new flag read.** Turns burn their fix budget on landings the guard refuses.

- Covers every guarded turn in the refactor tail: suite fix, quality fix, risk
  fix, nit fix, escalation describe
- Each prompt lists the strays and states the no-test-file and no-new-flag-read
  rules (reuse `refactorRules`)
- Feature tail prompts stay unchanged
- Pin with unit tests on the rendered prompts

### 5. Feature feedback lap amends the existing code — TECHNICAL

**After feature-review feedback, `implement.building` runs with the first-lap
prompt: "implement properly", "write the change fresh", "put it behind a new
release flag".** The feature code from the earlier lap is still in the tree, so
the turn must amend it.

- Feedback lap prompt: the change already exists; amend it to meet the
  re-derived `.gtd/REQUIREMENTS.md`
- Reuse the release flag the first lap added; add none (see Answered Questions)
- First lap prompt unchanged, reference line included
- Applies to the `afterTail` feedback path too, since it shares the loop

### 6. `demoteHeadings` reuses `markFenced` — TECHNICAL

**`demoteHeadings` in the refactor module carries its own looser fence tracker;
`markFenced` in the risk-tier module already handles indent ≤3, fence length and
closing rules.**

- Move `markFenced` to a shared place both modules import; keep it unexported
  from `@pmelab/gtd/workflows` unless the boundary rules require otherwise
- `demoteHeadings` keeps its behaviour on today's tests; add a case where the
  two trackers used to differ (a longer closing fence, an indented-4 non-fence)

### 7. Fix the stale `refactorFirst` doc — TECHNICAL

**`docs/configuration.md` still says "the shipped `feature` flow runs
`refactorFirst` only on the naive-pass path"; it now runs `reviewedRefactor`.**

- Correct that sentence and any other line in `### refactorFirst` that predates
  the review tail (e.g. the list of guarded turns now also includes the review
  tail's fix turns)
- No `src/*.ts` module name enters prose (AGENTS.md rule); exported API names
  are fine

### 8. Docs and breaking footer: `seamBuild` change, in-flight naive processes — TECHNICAL

**The `BREAKING CHANGE:` footer and docs mention only `seam.approve`; they miss
the `seamBuild` API change and what happens to other in-flight naive-pass
processes.**

- `seamBuild` is a public export: `seamBuild(tier)` became `seamBuild(base)`,
  returns `{ reference, base }`, and no longer runs `implement` — a custom
  workflow calling it must call `implement` itself
- Determine by test which rests of an in-flight `GTD_FLAG_NAIVE_PASS` process
  still replay (step order and slices changed); document the exact set that must
  `gtd abandon`
- Update `docs/configuration.md`'s **Upgrading** line, README if it covers the
  path, and the PR body
- The squash message's footer must carry both migrations (`docs/commits.md`: `!`
  plus a literal `BREAKING CHANGE:` footer)

## Answered Questions

### Do the two deferred review notes removed from `.gtd/TODO.md` become concerns?

No — the human deleted both (note-3 garbled-flag stdout, note-2
`gtd history list` scenario); a removal is the answer.

### On a feature feedback lap, does the amended change keep the first lap's release flag?

Yes — one feature, one flag; a second flag for the same behaviour is never what
a reviewer's note asks for.

### Do in-flight naive-pass processes get migration code, or a documented `gtd abandon`?

Documented `gtd abandon`, matching `seam.approve` — the flag is off by default
and COMPATIBILITY.md already treats a step-order change as breaking.
