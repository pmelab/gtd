# Prompt evals for the unified workflow (promptfoo)

Goal: catch regressions in `src/workflows/unified.yaml` prompts and compare
models, by grading the git outcome of one real driver turn — never the
transcript.

## Shape

- One eval case = a workflow state + fixture repo variants (e.g. spec-review:
  `violation` must produce `.gtd/SPEC_FEEDBACK.md` naming the planted defect,
  `clean` must stay silent). Two-sided fixtures so an always-flag or never-flag
  prompt fails.
- promptfoo `exec:` provider wraps a script: build fixture repo (reuse the
  composable e2e Given-step setup), run one real-model driver turn
  (`gtd next --json` → model → `gtd land`), print result path.
- Graders, cheapest first:
  1. deterministic `javascript` asserts on the resulting repo: only the
     contracted state file touched, exists/absent as expected, oxfmt fixed point
  2. grep floor for the planted defect
  3. `llm-rubric` judge (pinned model, never the model under test) for feedback
     quality
- `--repeat 4` trials; report pass rate per fixture (never averaged across
  fixtures). One provider entry per model = comparison matrix.
- Committed `baseline.json`; gate with `--compare --fail-on-regression`,
  baseline updated deliberately like a snapshot.

## Tasks

- [ ] `evals/` dir: promptfoo config, fixture-builder script, run-turn script,
      grader asserts
- [ ] First case: spec-review (violation + clean fixtures)
- [ ] `npm run eval` script — deliberate action like `test:mutation`, NOT in the
      turbo `test` graph
- [ ] Baseline workflow: record `baseline.json`, document update ritual
- [ ] README: how to run evals, add a case, compare models

## Constraints

- Real tokens, minutes per run: never autonomous, never CI-gated.
- Only encode past regressions as cases (review-loop deadlock, requireProgress
  origin, QA ordering) — no coverage-driven case writing.
