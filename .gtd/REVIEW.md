# Review: 28186ef

<!-- base: 27f20a4d4862799b363365901cea4a2af29ef9ed -->

A new `evals/` harness that grades gtd's own bundled prompts against a real
model through promptfoo, plus the tooling, docs, and regression gate around it.
Nothing in `src/` changed — this is all new scaffolding beside the product.

## Eval runner and per-cell reporting

`npm run eval` goes through `evals/eval.mjs` rather than the bare promptfoo CLI,
purely to suppress promptfoo's own end-of-run summary — that line sums pass/fail
across both fixtures and both models, which is the one number this design
refuses to show. `evals/report.mjs` prints the honest per-(model, variant)
matrix instead.

- [ ] ./evals/eval.mjs#64 — the suppression is a plain-text line filter: it
      starts suppressing on a line exactly equal to `Results:` and stops on one
      starting with `Duration:`. Risk: a promptfoo upgrade that reworks that
      summary silently restores the aggregate line, or worse, swallows real
      output from `Results:` to end-of-stream. Nothing pins promptfoo's output
      shape, and `promptfoo` is pinned to `0.122.1` in package.json, which is
      the only thing holding this together.
- [ ] ./evals/eval.mjs#83 — spawns `promptfoo` by bare name, so it only resolves
      when run through an npm script (which puts `node_modules/.bin` on PATH).
      `node evals/eval.mjs` typed directly fails. The `error` handler turns that
      into a clear message rather than a stack trace, so the failure mode is at
      least legible.
- [ ] ./evals/eval.mjs#119 — on a green promptfoo exit the matrix is printed by
      `compare()` and `printReport()` is deliberately skipped, so it prints
      exactly once. The two print paths are coupled only by comments; a future
      edit to either side double-prints or drops the matrix with no test
      catching it.
- [ ] ./evals/report.mjs#14 — cell key is `provider.label|vars.variant` with
      `?.` on both. A result missing either field collapses into a cell
      literally named `undefined|undefined` and gets counted, rather than
      failing loudly.

## Fixture repo construction

Each trial builds a throwaway git repo under the OS tmpdir, commits the case's
`base` files, writes the variant's files into the working tree, then runs
`gtd --entry <state>` so the entry commit captures exactly the variant's code as
the code under review.

- [ ] ./evals/fixture.mjs#31 — `scrubbedEnv` drops `GIT_DIR`, `GIT_WORK_TREE`,
      `GIT_INDEX_FILE`, `GTD_LOOP_LOG` and every `GTD_*` var. This is the guard
      that keeps a fixture's commits out of the real repository — exactly the
      corruption mode this repo has hit before. Every git and gtd call goes
      through helpers that assert cwd is under `tmpdir()` first.
- [ ] ./evals/fixture.mjs#70 — hand-rolls a pre-commit hook that mirrors husky →
      lint-staged → oxfmt, using this repo's resolved `oxfmt` binary and a copy
      of its `.oxfmtrc.json`. It always `exit 0`, so a formatting failure shows
      up as an eval result, not as a broken land. Risk: this is a second,
      divergent copy of the real hook's behaviour. It only formats `.gtd`, and
      nothing fails if the real lint-staged config changes.
- [ ] ./evals/fixture.mjs#138 — `sh -c` on the entry script gtd prints, with no
      check on what that script contains. Trusted input (gtd's own output), and
      cwd is asserted tmp on both sides of the call.
- [ ] ./evals/fixture.mjs#91 — `GTD_EVAL_WORKFLOW` inlines a scratch workflow
      YAML into the fixture's `.gtdrc.json`, so a workflow edit can be graded
      before it is committed.

## The one real driver turn

`run-turn.mjs` is the promptfoo `exec:` provider: it builds the fixture, runs
exactly one `gtd next` → `claude -p` → `gtd land` cycle, and prints one line of
JSON for the graders.

- [ ] ./evals/run-turn.mjs#92 — infra preconditions fail loudly and separately
      from grading: missing variant, missing `--model`, missing bundle, no
      `claude` on PATH, no `ANTHROPIC_API_KEY`. Good — an infra break can never
      read as a pass.
- [ ] ./evals/run-turn.mjs#97 — the "model under test is not the judge" guard is
      `JUDGE_MODEL.includes(model)`, a loose substring test against
      `anthropic:messages:claude-sonnet-4-5-20250929`. Risk: it both
      over-matches (a model named `4` or `claude` trips it) and under-matches (a
      differently-spelled alias for the same Sonnet snapshot passes).
- [ ] ./evals/run-turn.mjs#117 — calls `gtd next` five separate times to read
      `kind`, `session.id`, `model`, `system`, `validate`, then a sixth for the
      prompt. Risk: this assumes `gtd next` is side-effect-free on a resting
      prompt state. It is for this case, but the same pattern on an edge-driven
      state would mutate on each call. Worth a comment at the code, since
      nothing here enforces it.
- [ ] ./evals/run-turn.mjs#63 — `oxfmt --list-different` exit 1 means "found
      differences"; any other non-zero exit is treated as an infra failure
      rather than as "formatting converged". This is the right polarity and the
      risky one to get backwards.
- [ ] ./evals/run-turn.mjs#189 — `isStructurallyOk` duplicates, in slightly
      different code, the same four checks `evals/asserts/spec-review.mjs` runs.
      Risk: two copies of the grading rule drift. It exists so the tier-3 judge
      receives `"STRUCTURAL FAILURE"` instead of garbage, but `expectedGtdFiles`
      and `identifierOk` are near-verbatim reimplementations of the assert
      file's `checkGtdFilesChanged` and `checkPlantedIdentifier`.
- [ ] ./evals/run-turn.mjs#242 — `EVAL_CLEAN=1` does `rm -rf` on the fixture
      path without the `assertTmpCwd` guard every other spawn in this file uses.
      The path comes from `mkdtempSync`, so it is safe today; the missing
      assertion is the inconsistency, not a live bug.
- [ ] ./evals/run-turn.mjs#20 — one turn gets a 600s timeout. A timeout fails
      the trial loudly and keeps the repo for post-mortem.

## The spec-review case and its graders

Two-sided by construction: `violation` must produce `.gtd/SPEC_FEEDBACK.md`
naming `DivisionByZeroError`, `clean` must stay silent. A prompt that always
flags fails one side, one that never flags fails the other.

- [ ] ./evals/cases/spec-review.mjs#5 — frozen case object: `state`,
      `plantedIdentifier`, `base`, `variants`, `expect`. `expect` is declared
      but never read by `fixture.mjs`, `run-turn.mjs`, or the asserts — the
      variant-name comparison is hardcoded as `variant === "violation"` in three
      places instead. Dead data that reads as the source of truth.
- [ ] ./evals/asserts/spec-review.mjs#38 — four deterministic checks, first
      failure wins, each with a specific reason string. Covers "the reviewer
      must never fix anything" (`otherFilesChanged` empty) explicitly.
- [ ] ./evals/promptfooconfig.yaml#36 — tier 3 is an `llm-rubric` pinned to a
      Sonnet snapshot that is never in the provider matrix, so no model grades
      itself. Comment acknowledges promptfoo has no assert short-circuit, so a
      structurally broken turn still bills one judge call on a ~2-token input.
- [ ] ./evals/promptfooconfig.yaml#16 — the model rides on the provider command
      line as `--model`, injected as `GTD_PLANNERMODEL`, deliberately not a
      promptfoo `--var` that an ambient env var could outrank.

## Baseline regression gate

`evals/baseline.json` is a committed per-cell snapshot; a green promptfoo run
then has to also beat it. Rates, never counts, so a different `--repeat` still
compares.

- [ ] ./evals/baseline.json#2 — **the committed baseline is a fabricated 4/4
      placeholder, not a real run.** `recordedAt` says so in plain text and
      docs/development.md repeats it. Risk: the very first real `npm run eval`
      will almost certainly red — a perfect score on every cell of a
      non-deterministic agent turn is not a floor anyone will reproduce. That is
      a loud failure rather than a silent one, but the gate ships known-wrong
      and its first signal will be noise.
- [ ] ./evals/compare-baseline.mjs#49 — collects every violation instead of
      early-exiting, so a stale baseline shows the whole picture in one run.
      Missing on either side is a violation too, so a silently dropped fixture
      cannot pass.
- [ ] ./evals/compare-baseline.mjs#84 — `record()` is the only write path,
      reached only via `--record` / `npm run eval:baseline`. A passing run never
      refreshes its own baseline. Output is written then oxfmt'd with this
      repo's resolved binary, so the committed file is a fixed point and does
      not red `format:check`.
- [ ] ./evals/compare-baseline.mjs#98 — `compare()` signals failure via
      `process.exitCode = 1` rather than throwing or returning a status. Risk:
      an importing caller that later resets `process.exitCode` silently disarms
      the gate. `eval.mjs` reads it back immediately, and the tests save/restore
      it around each case, which is a hint at how easy that coupling is to
      break.
- [ ] ./tests/tooling/eval-baseline.test.ts#52 — unit coverage for the gate:
      dropped rate, equal, higher, different `--repeat`, missing on each side,
      plus "prints per-cell and never a spanning total" and "compare never
      rewrites the file". Solid — this is the part of the harness that can be
      tested without a model call, and it is tested.

## Tooling wiring

- [ ] ./turbo.json#15 — `evals/**` added to `lint`, `typecheck`, `deadcode`, and
      `test:unit` inputs. Required, because
      `tests/tooling/eval-baseline.test.ts` imports `evals/compare-baseline.mjs`
      — without it Turborepo replays a stale cached green after an eval-only
      edit.
- [ ] ./tests/tooling/turbo.test.ts#47 — pins those four inputs so the caching
      hole cannot reopen unnoticed.
- [ ] ./package.json#48 — `eval` hard-fails with a named message when
      `ANTHROPIC_API_KEY` is unset, then builds via `npx turbo run build` before
      driving. Deliberately not part of `npm test`.
- [ ] ./.fallowrc.json#14 — `evals/*.mjs` whitelisted as entry points and
      `promptfoo` added to `ignoreDependencies`, since it is only ever spawned
      as a binary. Note the glob is one level deep: `evals/cases/*.mjs` and
      `evals/asserts/*.mjs` are not covered, and are reachable only via
      `file://` strings in the YAML and imports from the top-level files.
- [ ] ./.gitignore#49 — `evals/results.json` ignored as regenerated output. The
      baseline that outlives a run stays committed.

## Docs

- [ ] ./docs/development.md#32 — a "Prompt evals" section covering
      prerequisites, the three env vars, the three grading tiers, why the
      aggregate line is stripped, how to add a case, the baseline gate, and how
      to re-record it. It names no `src/*.ts` module and describes only what a
      person running the command needs, which is what AGENTS.md asks of prose.
      It does name `evals/*.mjs` files — correct here, since those files are the
      user interface of the harness.
- [ ] ./docs/development.md#94 — explicitly states the flakiness expectation:
      one bad turn is 25% of a 4-trial cell, the eval is never a CI gate, and
      the fix for routine re-runs is more trials rather than a softer threshold.
- [ ] ./docs/development.md#71 — states the placeholder-baseline caveat in the
      doc as well as in the file. Re-recording it is called out as the first
      order of business once a key is available.

## Dependency churn

- [ ] ./package.json#73 — `promptfoo` pinned exactly to `0.122.1` (no caret),
      which is the right call given eval.mjs parses its stdout and results.json
      shape.
- [ ] ./package-lock.json — ~20k added lines, roughly 1780 new packages, all
      from the single `promptfoo` devDependency. Risk: a large new supply-chain
      surface for a dev-only, human-triggered tool. Worth a conscious accept
      rather than a skim; nothing in `npm test` or the published bundle depends
      on it.
