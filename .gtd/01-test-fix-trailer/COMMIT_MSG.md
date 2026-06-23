feat(escalate-cap): count test-fix attempts via Gtd-Test-Fix trailer

The verify/escalate iteration counter now counts the trailing run of commits
carrying a `Gtd-Test-Fix:` body trailer instead of the trailing run of
`fix(gtd):` subjects. Ordinary bug-fix work packages that happen to use the
`fix(gtd):` Conventional Commits type no longer false-trigger the escalate gate.

- Git: add `commitMessages` full-message reader (`--format=%B%x00`, NUL-split).
- Events: detect `/^Gtd-Test-Fix:/m` over the full message; rename the COMMIT
  flag `isFixGtd` → `isTestFix`.
- Machine: rename the COMMIT event field to `isTestFix` (no logic change).
- fix-tests prompt: emit the `Gtd-Test-Fix: <n>` trailer (subject unchanged).
- Cucumber step + feature fixtures: advance the counter via the trailer; add a
  negative plain-`fix(gtd):`-feature-commit scenario (the original bug repro).
- Docs: README.md + SKILL.md describe the trailer semantics + BC note.

NOTE: subject scope is `escalate-cap` (NOT `fix(gtd)`) on purpose — the OLD
running bundle still counts trailing `fix(gtd):` subjects, so a `fix(gtd):`
subject here could re-trigger the very false escalation this change removes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
