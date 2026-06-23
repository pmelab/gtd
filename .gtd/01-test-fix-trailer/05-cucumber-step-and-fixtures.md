# Cucumber: make the test-fix step emit the trailer + rewrite cap fixtures

After the detection change, a bare `fix(gtd):` subject no longer advances the
verify counter — only commits carrying the `Gtd-Test-Fix:` trailer do. The
cucumber step that advances the counter and the `.feature` cap scenarios must
all carry the trailer, or the escalate scenarios go red. Also add a NEW negative
scenario reproducing the original bug (plain `fix(gtd):` feature commits do NOT
escalate).

## Files

- `tests/integration/support/steps/common.steps.ts`
- `tests/integration/features/verify-loop.feature`
- `tests/integration/features/spec-test-loop.feature`
- `tests/integration/features/test-gate.feature`

## Step definitions (common.steps.ts, ~line 61)

- Update the existing
  `Given("a fix\\(gtd) commit {string}", ...)` step so the empty commit ALSO
  writes a `Gtd-Test-Fix:` trailer into the body — add a second `-m`:
  ```
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", message, "-m", "Gtd-Test-Fix: 1"], ...)
  ```
  Keep `--allow-empty` so the working tree stays clean (cap/escalate guards sit
  behind `codeDirty`). This step now genuinely advances the new counter.
- Add a SIBLING NEGATIVE step, e.g.
  `Given("a plain fix\\(gtd) feature commit {string}", ...)` that creates an
  empty `fix(gtd):` commit with NO trailer (single `-m`), so it does NOT advance
  the counter. Inline the `execFileSync`; each step maps to exactly one commit
  (per AGENTS.md).

## verify-loop.feature

- Rewrite the Feature description (lines ~3-5) around the trailer: trailing
  trailer-carrying commits advance the counter; a plain `fix(gtd):` feature
  commit (no trailer) does NOT advance / resets.
- The existing `a fix(gtd) commit "..."` lines (cap/below-cap scenarios) keep
  working unchanged because the step now emits the trailer.
- Extend the "non-fix commit resets" scenario (lines ~54-62) to ALSO cover the
  plain-`fix(gtd)`-feature-commit-resets case using the new negative step
  (a trailing plain `fix(gtd):` feature commit must not keep the counter high).

## spec-test-loop.feature

- The `a fix(gtd) commit "fix(gtd): attempt N"` lines (cap + below-cap scenarios)
  keep working via the updated step.
- The recurring-signature scenario (lines ~112-130, ERRORS.md path) is UNCHANGED.
- ADD A NEW SCENARIO reproducing the original report: a trailing run of plain
  `fix(gtd):` FEATURE commits (new negative step) with a GREEN test gate does NOT
  escalate (assert stdout does not contain "Escalate to the human"). Use a green
  package.json (`{ "scripts": { "test": "exit 0" } }`) and a clean tree so it
  resolves past the gate.

## test-gate.feature

- The cap scenario `fix(gtd) commit "..."` lines keep working via the updated
  step.
- Update the Feature/scenario prose (lines ~4-6, ~48-51) describing the
  "consecutive-fix(gtd) cap" to describe the trailer instead.
- The `stdout contains "fix(gtd): <desc>"` assertion (line ~44) STAYS — the
  prompt still emits that subject.

## Acceptance criteria

- [ ] `a fix\(gtd) commit` step writes a `Gtd-Test-Fix:` trailer (second `-m`).
- [ ] A new negative step emits a `fix(gtd):` commit with NO trailer.
- [ ] verify-loop.feature description + reset scenario updated for the trailer.
- [ ] spec-test-loop.feature has a NEW green-tests-with-plain-fix(gtd)-commits
      scenario asserting NO escalation; recurring-signature scenario unchanged.
- [ ] test-gate.feature prose updated; `fix(gtd): <desc>` assertion retained.
- [ ] `npm run test:e2e` passes (all cap/below-cap/escalate scenarios green).

## Constraints / edge cases

- File-disjoint: edit only these four files. Do NOT touch src or docs.
- The e2e hooks rebuild `scripts/gtd.js` from src at runtime, so these scenarios
  exercise the NEW detection code even before the committed bundle is refreshed
  in package 02 — the suite is green within this package as a unit.
- Keep all counter-advancing commits empty (`--allow-empty`) so they don't trip
  the `codeDirty` branch.
