# Review: 48b8a15

<!-- base: fcd5ab72224afa9e5303528a25a4f8703790c7ca -->

**The tenth eval case now exists.** `architecture.decompose` used to ship a
written excuse instead of a case, because its turn writes a variable number of
package files and every grader compared changed paths with one exact array. This
branch replaces that equality with a shared matcher that also accepts a "these
exact paths, plus N more matching this pattern" descriptor, adds the case, its
grader, and its config wiring, and separately fixes a hole where a refused
`gtd land` scored as a pass.

`npx vitest run tests/tooling/run-turn.test.ts` — 22 passed.

## Shared path matcher replaces two divergent equality checks

`evals/run-turn.mjs` and `evals/asserts/shared.mjs` each kept their own
`JSON.stringify` comparison of changed `.gtd/` paths. They agreed by
coincidence. Both now call one function, which grew a second accepted shape.

- [x] ./evals/expect.mjs#13 — new `matchGtdFiles`: returns `undefined` on a
      match, a reason string on a mismatch. Array expectation keeps
      byte-identical behavior; object expectation is the new
      `{exact, matching: {pattern, count}}` descriptor.
- [x] ./evals/expect.mjs#33 — **the two branches enforce different strictness.**
      The array branch is order- and duplicate-sensitive (`JSON.stringify`
      equality). The descriptor branch is neither: `exact` is checked by
      `includes`, and the rest only by count and pattern. A turn writing
      `01-a.md` twice, or writing them out of settled order, passes. Order is
      the one thing the decompose prompt asks for ("in the settled order"), so
      this is a real gap, not a nit — decide whether you want it graded.
- [x] ./evals/expect.mjs#43 — malformed descriptors (missing `exact`, missing
      `matching`, non-array `exact`, non-numeric `count`, uncompilable
      `pattern`) each return a named reason rather than throwing. Good: a grader
      that throws kills a paid trial instead of failing it.
- [x] ./evals/run-turn.mjs#469 — call site in `isStructurallyOk`, inverted with
      `!` because the function returns a reason string on failure. Correct but
      reads backwards; a `matchesGtdFiles` boolean wrapper would cost nothing.
- [x] ./evals/asserts/shared.mjs#21 — `checkGtdFilesChanged` now delegates too,
      so the grader's reason text and the cheap tier's verdict can no longer
      drift.

## New `architecture-decompose` case

Two-sided on the one authority the state does not have: merging or splitting
concerns. `architecture.author` already made that call upstream.

- [x] ./evals/cases/architecture-decompose.mjs#1 — the fixture. `violation`
      plants two requirements bundled under one heading plus a
      `## Merged Concerns` record; a correct turn carries the bundle over as one
      file and writes no file for the record — 3 files either way.
- [x] ./evals/cases/architecture-decompose.mjs#8 — **the `clean` variant grades
      almost nothing.** Its three concerns are disjoint, one heading each, so a
      naive "one file per `##` heading" turn passes it. The fixture comment says
      so outright. Accept it as the two-sided-symmetry cost, or drop it and save
      two paid cells per run.
- [x] ./evals/cases/architecture-decompose.mjs#78 — both variants expect
      `.gtd/ARCHITECTURE.md` (deleted by the turn) plus exactly 3 files matching
      `^\.gtd/packages/\d\d-[a-z0-9-]+\.md$`, and `otherFiles: "none"`.
- [x] ./evals/asserts/architecture-decompose.mjs#15 — the one state-specific
      check: no package file may contain a `.gtd/` reference, matching the
      prompt's own rule. Two limits worth naming: the regex `/\.gtd\/\S+/` also
      flags a file referencing ITSELF (the prompt bans "any other" `.gtd/`
      file), and it returns on the first offending file, so a run never sees the
      second.
- [x] ./evals/run-turn.mjs#482 — new `readPackageFiles` feeds that grader
      `{path: content}` for `.gtd/packages/`. **It reads the whole directory
      after landing, not the paths the turn changed.** Harmless today because
      the base fixture ships no package files; a future fixture that pre-plants
      one would have it silently graded as the turn's output.
- [x] ./evals/promptfooconfig.yaml#340 — two `tests:` entries, each with a
      `challenge` that spells out the trap. Neither carries an `llm-rubric`: the
      case declares no `artifact`, so there is no single file to judge. Cell
      count goes 18 → 20.
- [x] ./evals/cases/architecture-decompose.md#1 — deleted. It existed only to
      state why the case could not exist. Correct removal.

## Land refusal no longer scores as a pass

The bug: `gtd land` refusing leaves every file-list field empty, which is
exactly what a `clean` variant expecting "changed nothing" wants to see.

- [x] ./evals/run-turn.mjs#495 — `landAndInspect` catches the throw and returns
      a full result carrying `landError` instead of crashing. The reasoning is
      sound: a stack trace with empty stdout gives promptfoo's `exec:` provider
      nothing to parse, so the whole trial dies rather than failing.
- [x] ./evals/run-turn.mjs#495 — **the `try` wraps all of `land()`, not just the
      land call.** Both `git rev-parse HEAD` calls sit inside it, so a git
      failure or a broken fixture repo is reported to the human as "gtd land
      refused: ...". Misleading on the one output a debugger reads.
- [x] ./evals/asserts/shared.mjs#16 — `checkLandError`, ordered first in
      `SHARED_CHECKS` so the reason names the refusal rather than a downstream
      symptom.
- [x] ./tests/tooling/run-turn.test.ts#193 — regression test drives the exact
      bug shape: a `clean` case expecting `gtdFiles: []`/`otherFiles: "none"`
      with `landError` set must fail. Plus eight `matchGtdFiles` tests covering
      both branches and every malformed-descriptor path.

## Docs and baseline

- [x] ./docs/development.md#36 — "nine of the ten" → "all ten"; the
      stated-reason paragraph is gone.
- [x] ./docs/development.md#110 — the add-a-case recipe now documents both
      `gtdFiles` shapes and moves `architecture-decompose` from "the case that
      does not exist" to "the case with no `artifact`". Names
      `evals/expect.mjs`, which is an eval-harness path a case author must
      touch, not a `src/*.ts` module — inside the AGENTS.md rule.
- [x] ./evals/baseline.json#13 — **two new entries claim 4/4 passing.** Confirm
      those numbers came from a real `npm run eval`, not from assumption. A
      baseline that was never measured turns the first honest failure into a
      false regression.
- [x] ./evals/run-turn.mjs#417 — `readFeedback`'s comment updated: the
      no-`artifact` branch now has a live case, and the unit test still pins it
      without a paid run.
