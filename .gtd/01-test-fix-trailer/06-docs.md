# Docs: describe the `Gtd-Test-Fix:` trailer semantics in README.md and SKILL.md

Per CLAUDE.md ("reflect every significant change in the readme"), replace the
"trailing run of `fix(gtd):` commits / non-`fix(gtd):` resets" descriptions with
the trailer semantics. Keep `fix(gtd): <desc>` as the SUBJECT the prompt
instructs; state the COUNTED signal is the `Gtd-Test-Fix:` trailer.

## Files

- `README.md`
- `SKILL.md`

## README.md edits

- `escalate` row (line ~58): the trailing `fix(gtd):` run → the trailing run of
  `Gtd-Test-Fix:`-trailer commits hit the cap.
- verify-loop blockquote (lines ~77, ~90-94): the counted run is
  trailer-carrying commits; a commit WITHOUT the trailer resets the counter to 0.
  Keep the "commits on success (`fix(gtd): <desc>`)" wording for the subject.
- Mermaid edge labels (lines ~190, ~211) referencing the `fix(gtd):` run → trailer.
- Cap/reset prose (lines ~241, ~250, ~263-265, ~334-335): describe the trailer as
  the counted signal; "Commit a fix with any non-`fix(gtd):` prefix to reset" →
  "any commit without the `Gtd-Test-Fix:` trailer resets the counter".
- Add a short BC note: existing mid-flight loops at upgrade may run up to 2 extra
  test-fix attempts once (old markerless `fix(gtd):` test-fix commits stop
  counting); no code fallback; strictly safer (never escalates a green/recoverable
  build early) and never masks a real `ERRORS.md` escalation (independent guard).

## SKILL.md edits

- The "edge counts the trailing run of `fix(gtd):` commits at HEAD" blockquote
  (lines ~114-116) → trailing run of `Gtd-Test-Fix:`-trailer commits.
- `escalate` row (lines ~125-126) → trailer-trailing-run hit the cap.
- fix-tests-prompt paragraph (lines ~160-161): the prompt instructs a
  `fix(gtd): <desc>` subject AND a `Gtd-Test-Fix: <n>` trailer; the trailer is
  the counted signal.

## Acceptance criteria

- [ ] No README.md/SKILL.md prose claims the counter counts `fix(gtd):` SUBJECTS
      (the subject is now only the human-readable label; the trailer is counted).
- [ ] Trailer semantics + reset behavior documented in both files.
- [ ] BC note present in README.md.
- [ ] `fix(gtd): <desc>` retained where it describes the success-commit subject.
- [ ] `npm run test` and the e2e suite still pass (docs-only — no behavior change).

## Constraints / edge cases

- File-disjoint: edit only `README.md` and `SKILL.md`. Docs-only; no code.
- The cap value `MAX_VERIFY_ITERATIONS = 3` and its non-overridable nature are
  UNCHANGED — do not reword those.
