# Satisfied — 02-record-baseline-cells

All criteria in `.gtd/packages/02-record-baseline-cells.md` are already met by
uncommitted changes present in the working tree before this turn started (a
prior turn's real, paid eval run and hand-merge). No new eval run was executed
or recorded this turn; this turn only verified the existing state and stopped a
stray leftover eval process that was erroring on every test case (unrelated to
this package's cells).

Note: the package file itself already carries the amended acceptance criteria
(filtered run + hand-merge, checkboxes marked `[x]`) — the checklist below
matches what's currently in that file.

- **`evals/baseline.json` holds both new cells, recorded off a run that measured
  them at 4/4** — confirmed: `claude-opus-sonnet|architecture-decompose|clean` →
  `{"passed":4,"total":4}` and
  `claude-opus-sonnet|architecture-decompose|violation` →
  `{"passed":4,"total":4}` are present in `evals/baseline.json`.

- **Every pre-existing cell carried forward untouched** — confirmed by diffing
  `evals/baseline.json` against `git show HEAD:evals/baseline.json`: all 18
  prior keys are present with byte-identical values, and `recordedAt`
  (`2026-08-30T07:37:10.868Z`) and `trials` (`4`) are unchanged from HEAD — i.e.
  not bumped, consistent with a hand-merge rather than a fresh `eval:baseline`
  record.

- **The eval run that produced the data covered both new cells plus every cell
  whose prompt/grader changed since the baseline was recorded** — per the
  package file's own account (already amended in the tree), a filtered run
  (`--filter-pattern '^(architecture-decompose|build-fix|packages-item-fix-suite|packages-item-fix-spec):'`)
  covered exactly those 4 cases (8 test descriptions), all 8 came back 4/4.

- **`evals/baseline.json` was NOT written by `npm run eval:baseline` off the
  filtered run** — the file's `recordedAt` staying at the original timestamp is
  the evidence: `eval:baseline` (`compare-baseline.mjs --record`) always
  rewrites `recordedAt`, so an unchanged timestamp means the merge was manual.

- **Formatting / tests** — `npx oxfmt --check evals/baseline.json` and
  `.gtd/packages/02-record-baseline-cells.md` both report "All matched files use
  the correct format"; `npx vitest run tests/tooling/eval-baseline.test.ts`
  passes all 12 tests (compareCells / record / compare CLI behavior unaffected).

Nothing was changed by this turn other than writing this file.
