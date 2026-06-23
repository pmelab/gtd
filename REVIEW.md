# Review: d78b6fc

<!-- base: d78b6fcd37f832728dc3fb47078c0ca1e908d790 -->

## Bug 1: code-changes no longer commits REVIEW.md

The `code-changes` prompt now unstages `REVIEW.md` after `git add -A` (mirroring
the existing `TODO.md` handling), so a source edit made alongside review
feedback commits verbatim while `REVIEW.md` stays pending — the next fold
reaches `review-process` instead of stranding the feedback at `await-review`.

- [ ] ./src/prompts/code-changes.md#4
- [ ] ./tests/integration/features/review.feature#228

## Bug 2: scope `!!` harvesting to the reviewed files

`grepBang` now takes a pathspec and greps only those files (keeping the
`:!REVIEW.md`/`:!TODO.md` exclusions); an empty pathspec scopes to nothing.
`gatherEvents` calls it only when `REVIEW.md` exists, passing the union of the
files the current `REVIEW.md` references (its `./path#N` chunk refs) and the
dirty working-tree paths — so gtd's own docs/fixtures are no longer harvested.

- [ ] ./src/Git.ts#202
- [ ] ./src/Git.ts#237
- [ ] ./src/Events.ts#240
- [ ] ./src/Events.ts#259

## Bug 2 tests and docs

A new `spec-harvest` scenario proves an out-of-scope, non-dirty `!!` comment is
NOT harvested (it asserts close-review, since harvesting would have flipped the
approval to review-process). `review-process.md`, README, and SKILL wording now
state harvesting is scoped to the reviewed files plus the dirty tree.

- [ ] ./tests/integration/features/spec-harvest.feature#101
- [ ] ./src/prompts/review-process.md#39
- [ ] ./src/Git.test.ts#352

## Escalate cap: count a Gtd-Test-Fix trailer

The verify/escalate counter now keys off a `Gtd-Test-Fix:` commit trailer
instead of the `fix(gtd):` subject, so ordinary bug-fix work packages that use
the `fix(gtd)` type no longer false-trigger escalation. New `commitMessages`
reader (`--format=%B%x00`, NUL-split) exposes the full body; `gatherEvents`
detects the trailer via `/^Gtd-Test-Fix:/m`; the `isFixGtd`→`isTestFix` rename
flows through the pure machine unchanged in behavior.

- [ ] ./src/Git.ts#19
- [ ] ./src/Git.ts#258
- [ ] ./src/Events.ts#192
- [ ] ./src/Machine.ts#72
- [ ] ./src/Machine.ts#153

## Escalate cap: emit the trailer + tests

The fix-tests prompt now instructs a `Gtd-Test-Fix: <n>` trailer on the success
commit (subject kept as `fix(gtd): <desc>`). The cucumber test-fix step writes
the trailer; a new negative step + scenarios prove plain `fix(gtd):` feature
commits with a green gate do NOT escalate (the original repro). Unit tests cover
the trailer regex and the renamed flag.

- [ ] ./src/prompts/fix-tests.md#18
- [ ] ./tests/integration/support/steps/common.steps.ts#55
- [ ] ./tests/integration/features/verify-loop.feature#1
- [ ] ./tests/integration/features/verify-loop.feature#84
- [ ] ./tests/integration/features/spec-test-loop.feature#128
- [ ] ./tests/integration/features/test-gate.feature#3
- [ ] ./src/Events.test.ts#32
- [ ] ./src/Machine.test.ts#35

## Escalate cap: docs

README and SKILL describe the counted signal as the `Gtd-Test-Fix:` trailer (not
the subject), the reset-on-any-trailerless-commit behavior, and a
backward-compat note (mid-flight loops may run ≤2 extra attempts once at
upgrade; no fallback, strictly safer).

- [ ] ./README.md#55
- [ ] ./README.md#74
- [ ] ./README.md#239
- [ ] ./SKILL.md#111
- [ ] ./SKILL.md#160
