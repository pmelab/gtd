# Spec feedback — 01-eval-suite

The vertical slice is real and works: I built the `violation` fixture with
`evals/fixture.mjs` against the current bundle and it rests at `kind: prompt`,
`--json=model` returns the injected `GTD_PLANNERMODEL`, `--json=validate` is
empty, and `startCommit` is the base commit — so the review range holds exactly
the planted defect. `lint`, `format:check` and `deadcode` are green over
`evals/`. Six concrete problems remain.

## 1. Requirement C's reporting acceptance is unmet — the run prints one aggregate spanning both fixtures AND both models, and no per-fixture pass rate at all

Task 7's last bullet ("Nothing printed anywhere computes a mean across fixtures
or across models") and the matching acceptance bullet are violated by the report
`npm run eval` actually produces. I ran promptfoo 0.122.1 with this config's
exact shape (2 providers x 2 tests x `--repeat 4 --max-concurrency 2`) and the
run ends with:

```
Results:
  ✓ 16 passed (100%)
  0 failed (0%)
```

That percentage is a mean over both fixtures and both models — exactly the
number the spec forbids. The table above it is 16 undifferentiated
`[PASS]`/`[FAIL]` rows under two provider columns (`[planner] {{variant}}`,
`[cheap] {{variant}}`); **nowhere does it print "violation: 3/4 planner, 1/4
cheap"**. `evals/results.json`'s `prompts[].metrics.testPassCount` is per
provider but still summed across both fixtures, so it does not carry the number
either.

Fix: the `eval` script must produce the per-fixture, per-model rate itself —
e.g. a small post-run step over `evals/results.json` that groups
`results.results[]` by `(vars.variant, provider.label)` and prints `n/4` per
group — and must not leave promptfoo's cross-cutting aggregate as the run's
report.

`docs/development.md` currently states this as already true: "The report is a
pass rate **per fixture, per model** (out of `--repeat`'s trial count)". Today
that sentence describes something the tooling does not print.

## 2. `structurallyOk` omits tier 2, but task 3 defines it as tiers 1 AND 2

`evals/run-turn.mjs:157` `isStructurallyOk()` checks only `gtdFilesChanged`,
`otherFilesChanged` and `unformatted` — tier 1. The grep floor (feedback
contains `spec.plantedIdentifier`) is implemented only in
`evals/asserts/spec-review.mjs:31`, never in the flag the config's rubric gates
on.

Effect: a `violation` turn that writes a well-formed but wrong
`.gtd/SPEC_FEEDBACK.md` — right file, right formatting, never names
`DivisionByZeroError` — has `structurallyOk: true`, so the judge is billed a
full-size call on feedback the cheap tier already rejected. Add the
`plantedIdentifier` check (violation-only) to `isStructurallyOk`.

## 3. A broken oxfmt run is silently graded as "formatting converged"

`evals/run-turn.mjs:65` catches every `execFileSync` failure from
`npx oxfmt --list-different .gtd` and returns `String(err.stdout ?? "")`. The
catch is written for the intended case — `--list-different` exits 1 when it
finds differences, with the list on stdout — but it cannot distinguish that from
`npx` failing outright (no network in a fresh temp repo with no `node_modules`,
registry error, oxfmt not resolvable). In that case `err.stdout` is empty,
`unformatted` is `[]`, and both the tier-1 assert and `structurallyOk` read it
as "converged".

That is the failure mode task 4 forbids by name: "An infra break must never read
as a passing eval." Distinguish exit code 1 (differences found, stdout is the
list) from any other failure, and treat the latter as infra failure — non-zero
exit with the reason on stderr.

## 4. promptfoo's result cache is not disabled, so `--repeat 4` can silently collapse into one real turn

`ScriptCompletionProvider` caches on
`exec:<command>:<file hashes>:<prompt>:<options>` and `--repeat` does not
disable caching. Today the cache is skipped by accident only: `getFileHashes`
resolves `run-turn.mjs` against promptfoo's **process** cwd, which is the
repository root under `npm run eval`, so no script file hashes and promptfoo
logs "caching will not be used". Run the same config with `evals/` as cwd —
which task 7 invites, since it hands a human the `--repeat` override to run by
hand — and the hashes resolve, trials 2-4 return trial 1's cached JSON, and a
noisy 1-in-4 failure is reported as 4/4 identical. Pass `--no-cache` in the
`eval` script (and say so in `docs/development.md`), rather than relying on a
path-resolution accident.

## 5. `parseArgs` drops the variant when `--model` is absent, so the error names the wrong thing

`evals/run-turn.mjs:27` — with no `--model`, `modelIdx` is `-1`, and the filter
`i !== modelIdx && i !== modelIdx + 1` then strips index `0`, the variant.
`checkInfra` reports `unknown or missing variant "undefined"` for what is
actually a missing `--model`, sending a debugger after the wrong argument. Guard
the `-1` case.

## 6. The per-spawn cwd guard is missing on four of the six child processes

Task 4 asks for "a single `assert(cwd.startsWith(tmpdir))` guard before each
spawn". It is present on `git()`/`gtd()` in both files, and absent on every
other spawn that takes `cwd: repo`: the `sh -c` of the entry script
(`evals/fixture.mjs:115`), the `node dist/gtd.bundle.mjs --entry`
(`evals/fixture.mjs:110`), the `claude -p` turn (`evals/run-turn.mjs:113`), the
`sh -c` of the land script (`evals/run-turn.mjs:135`), and `npx oxfmt`
(`evals/run-turn.mjs:59`). The land script in particular is generated shell that
runs `git commit` — the one spawn the guard exists to fence.
