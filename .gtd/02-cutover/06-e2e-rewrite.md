# Task: Rewrite the cucumber e2e suite to the 16 states

Replace `tests/integration/features/` + the step definitions so the e2e suite
exercises the new machine end-to-end (built bundle → flat `gtd:` taxonomy → 16
states). Part of the **atomic cutover** package; file-disjoint from the src
tasks (owns only `tests/integration/**`). The features assert the **runtime
behaviour** defined by `STATES.md` + the shared contract in
`01-machine-resolver.md` (flat commit subjects, state prompts) — author against
that spec; the suite goes green once the sibling src tasks land.

Spec pointers: `STATES.md` § States (Actions + Prompt of each); `TODO.md` →
"Tests (AGENTS.md: cucumber per feature…)" for the exact coverage list; AGENTS.md
(composable, generic Given steps; one step = one commit; expose file
content/changes in scenario text).

## Delete

All obsolete feature files: `auto-advance`, `branches`, `commit-intent`,
`edge-loop`, `execute-gate`, `review`, `review-frontier`, `spec-decompose`,
`spec-execute`, `spec-feedback`, `spec-grilling`, `spec-principles`,
`spec-resume`, `spec-review`, `spec-review-conclude`, `spec-state-encoding`,
`spec-test-loop`, `spec-verbatim-first`, `test-gate`, `verify-loop`. Delete the
obsolete step files `support/steps/spec-review.steps.ts` and
`support/steps/review.steps.ts`. **Keep** `formatting.feature` +
`support/steps/formatting.steps.ts` (Format is unchanged) and the
`support/world.ts`, `support/hooks.ts`, `support/formatter.ts`, `helpers/
project-setup.ts` harness.

## New / updated Given steps (`support/steps/common.steps.ts` + a new steps file)

Remove the steps tied to the old taxonomy (`a fix\(gtd) commit …` +
`Gtd-Test-Fix:`, `a plain fix\(gtd) feature commit …`, `a package dir … with
COMMIT_MSG.md …`, `a prior review commit for …`, `a prior close commit for …`).
Add generic, composable builders:

- a flat `gtd:` commit builder, e.g. `a commit "gtd: <phase>"` (empty or adding
  a file with content), so scenarios spell out the exact subject.
- a plain task-file package dir, e.g. `a package dir "<.gtd/NN-name>" with task
  "<NN-task.md>"` (no `COMMIT_MSG.md`).
- a pending `ERRORS.md` deletion step (delete a committed `ERRORS.md` in the
  working tree) for the Testing human-resume case.
- a `FEEDBACK.md` step (committed vs uncommitted; empty vs content).
Keep file content/changes visible in the scenario text per AGENTS.md.

## Coverage (one feature file per area, per `TODO.md` "Tests")

- **New Feature:** seed from a dirty tree on a boundary HEAD; regenerate after
  checkout (HEAD `gtd: new task` + clean tree re-seeds); revert leaves a clean
  baseline.
- **Grilling 3-way:** marker present → STOP; no marker + pending → iterate; no
  marker + clean → Grilled (`gtd: grilled`).
- **Grilled → Planning → Building:** decompose, `.gtd` modified →
  `gtd: planning`, clean → Building selects the lowest package.
- **Testing:** green → Agentic Review; red below cap → `gtd: errors` + Fixing;
  cap → `ERRORS.md` + Escalate (STOP); reset-on-resume (rm `ERRORS.md` → fresh
  budget); no-op fixer re-test (clean tree + HEAD `gtd: fixing`).
- **Fixing:** committed FEEDBACK → `gtd: fixing`; uncommitted FEEDBACK →
  `gtd: feedback`.
- **Agentic Review:** empty FEEDBACK → Close package; content → Fixing; pending
  (no FEEDBACK yet) → re-review (never skipped); threshold → force-approve;
  `agenticReview:false` → force-approve.
- **Close package:** one `gtd: package done` per package; last package also
  removes `.gtd/`.
- **Clean → Await → Accept(seed)/Done → Idle;** coworker/feature-branch review
  entry (merge-base base); default-branch base = last `REVIEW.md` deletion.
- **Replay:** checkout any committed point resumes deterministically.
- **Illegal-combination hard-error** (e.g. ERRORS+FEEDBACK) → non-zero / error
  message. **Transport reset:** a hand-made `gtd: transport` HEAD → mixed reset →
  re-derive.
- **Config:** update `config.feature` for the new model-state keys + caps
  (`fixAttemptCap`/`reviewThreshold`); drop the removed keys.

## Constraints

- The suite runs the built bundle (`pretest:e2e` runs `npm run build`); assert on
  landed commit subjects (`the last commit subject is "gtd: …"`) and on prompt
  stdout, using the existing `Then` helpers in `common.steps.ts`.
- Edge-driven auto states emit no prompt — assert the landed commit, not a
  retired prompt string (the existing post-loop pattern).
- Keep features `not @skip` unless intentionally aspirational.

## Files

- Delete: the obsolete `tests/integration/features/*.feature` + the two obsolete
  steps files.
- Add: new feature files (grouped by the areas above).
- Modify: `tests/integration/support/steps/common.steps.ts`,
  `tests/integration/features/config.feature` (+ `support/steps/config.steps.ts`
  if needed). Add a new steps file for the flat-`gtd:`/package/FEEDBACK/ERRORS
  builders.

## Acceptance criteria

- [ ] Every area above has passing scenarios against the built new pipeline.
- [ ] No feature/step references the old taxonomy (`plan|review|chore(gtd):`,
      `Gtd-*` trailers, `COMMIT_MSG.md`, checkboxes).
- [ ] `formatting.feature` still passes unchanged.
- [ ] `npm run test:e2e` passes at package completion.
