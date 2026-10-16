# Quality review

## ponytail-review

Non-blocking. The `defaultModel` field passing through Command → JudgeRequest →
RunJudgeInput is necessary: `flags-only-at-composition-points` allows only
`src/cli/Cli.ts` to read the flag. So production code is lean. What can go is
tests that check the same thing in more than one place.

- `src/cli/Cli.test.ts:L1293-1341`: delete: whole `runCli — judge_sonnet` block,
  including its `process.stdin` monkeypatch. The `judge-run.feature` scenarios
  at L303 and L321 run the same seam (flag → Cli → Program → runJudge → claude
  argv) end to end, for both on and off. Nothing replaces it.
- `src/cli/Cli.test.ts:L1337-1340`: delete: `parseArgv never sets defaultModel`.
  This holds by construction because parseArgv has no code path that sets the
  field. Covered by the item above if the block goes.
- `tests/integration/features/judge-run.feature:L339-374`: delete: the
  `yields to GTD_JUDGE_MODEL` and `yields to --model` scenarios. The order of
  precedence is runJudge logic, and `src/judges/run.test.ts:L184`
  (`loses to --model, GTD_JUDGE_MODEL and judge.json`) already pins it,
  judge.json included. Keep the two on/off wiring scenarios.
- `src/judges/providers/llm.test.ts:L122-127`: delete:
  `passes an explicit model to claude`. Already covered by `run.test.ts`
  `layers per field` (`--model file` through llm), by the new `loses to` case,
  and by the existing feature scenario that asserts `--model sonnet`.
- `src/judges/run.test.ts:L234-250`: shrink: two near-identical
  `does not trip the pairing check` tests. Use one `it.each(["fixed", "jev"])`,
  or drop the `jev` case, because `does not stop jev auto-selection` (L214)
  already reaches the jev path with `defaultModel` set.
- `docs/driver.md:L855-857,L870-871` and `README.md:L419-420`: shrink: the
  "slower and costlier" caveat for `GTD_FLAG_JUDGE_SONNET` is written out three
  times. State it once, in driver.md's `--provider llm` paragraph. Every other
  mention becomes just "`sonnet` under `GTD_FLAG_JUDGE_SONNET=1`".

net: -110 lines possible.

## test-audit

Non-blocking. The guards that matter hold: `run.test.ts`
`does not stop jev auto-selection` and both `does not trip the pairing check`
cases would each fail if `defaultModel` went into `selectJudge`/`checkPairing`
instead of only the `llm(...)` call. `is the model when no layer sets one` fails
if it is dropped. Gaps and weak spots:

- Gap, CLI → provider: "never selects a provider" is proven only at `runJudge`.
  Every new feature scenario sets `TYPESAFE_API_KEY` to `""`, and the
  `Cli.test.ts` checks use `toMatchObject`, which allows extra keys. So if
  `Cli.ts` set `model: "sonnet"` (alone, or next to `defaultModel`) when the
  flag is on, no scenario would fail. In production that silently moves
  jev-keyed users onto claude. Fix: add one `@inmem` scenario: flag `1`,
  `TYPESAFE_API_KEY` `"k"`, a judge stub server answering 200, no `--provider`.
  Assert the jev verdict lands and claude was never run. That one scenario
  replaces the `runCli — judge_sonnet` block that ponytail-review wants deleted
  (the block also monkeypatches `process.stdin` and pins the internal
  `JudgeRequest` shape).
- Weakened by the flag-flip pass: `judge-run.feature:L285`
  `--model reaches claude's argv` passes `--model sonnet`. In the
  `GTD_FLAG_JUDGE_SONNET=1` pass of `npm test`, the default is already sonnet,
  so that scenario passes even if `--model` is ignored. Fix: change it to
  `--model opus`. Then the new `judge_sonnet on yields to --model` scenario
  (L357) duplicates it in both passes and can go.
- A test value that matches the default: `run.test.ts:L199` and
  `judge-run.feature:L341` use `GTD_JUDGE_MODEL=haiku`, which is `llm.ts`'s own
  `DEFAULT_MODEL`. If the env layer and `defaultModel` were both ignored, the
  result would still be haiku, so the test cannot fully show what its name
  claims. Fix: use a value no default produces (e.g. `env-model`).
- Copies the manifest: `flags/index.test.ts:L124` `toEqual` copies the whole
  `FLAGS` entry, `expiry` included. Bumping the expiry, which changes no
  behaviour, breaks it, and no credible regression is caught by it alone. Fix:
  keep `toMatchObject({ kind: "release" })` as `risk_tier` does, or drop it. The
  following `resolves off unset and on` test repeats the generic `resolveFlags`
  cases. Its only real job, binding the name `GTD_FLAG_JUDGE_SONNET`, is already
  covered by the on/off feature scenarios.

## conventions

Non-blocking. The docs edits name no `src/*.ts` module or internal symbol. The
`docs/cli.md` help block is kept in step with `Cli.ts`. The README carries the
flag. Each behaviour has an `@inmem` scenario. Findings against `AGENTS.md`:

- `src/cli/Cli.ts:L1472`: the comment states the decision but not the reason.
  Rule: "Put it at the code it constrains, and keep it to the decision and its
  reason". The comment says "against the shipped registry (not io.flags)" but
  never says why. The reason: typed against `FLAGS`, so deleting the registry
  entry turns this read into a compile error that cleanup must resolve. That
  reason is non-obvious and lives only in the deleted plan. Fix: e.g.
  `// GTD_FLAG_JUDGE_SONNET: typed against FLAGS (not io.flags) so deleting the entry fails to compile here.`
- `gtd.config.ts:L1`: the extended comment repeats the import list right below
  it. Rule: "Everything else (restatement of the code, history, a 'what' with no
  'why') gets deleted". The old version listed three workflows and was already
  borderline. Adding two more makes it a pure list of the exports. Fix: drop the
  enumeration and keep the two lines about `--workflow <name>` and the default
  export.
- `src/cli/Cli.test.ts:L1305-1313`: the test replaces the global `process.stdin`
  through `Object.defineProperty`. Rule: "reach every external resource (... a
  spawned program) through a port with a live and an in-memory implementation".
  `gtd judge run` reads `process.stdin` directly (`Program.ts:L417`, which
  predates this change), so stdin has no in-memory twin. The new test works
  around that gap instead of using a port. It also leaks a global if run in
  parallel. This agrees with ponytail-review: delete the block, since the
  feature scenarios already cover the seam. Don't add more tests that patch
  `process`.
- `src/judges/run.test.ts` `runJudge defaultModel` (L155-250): every case writes
  a real shell shim to `tmpdir()` and spawns it as `claude`, and `home()` writes
  a real `judge.json`. Rule: same port/twin rule. The `judge-run.feature`
  `claude answers with` step shows an in-memory claude twin exists. The file's
  existing `shimDir` tests use the same pattern, so this is not new debt, but
  the change adds five more real-process unit tests where the feature tier
  already reaches the same paths in memory.

## spec-challenge

Blocking. One planned test conflicts with the rollout workflow, and this branch
is about to run that workflow. The rollout as planned cannot land.

- Decision (ARCHITECTURE "Unit Tests", package 01 task 1): pin `judge_sonnet` as
  "no `defaultOn`; `resolveFlags({})` leaves it off". The tests built from it:
  `src/flags/index.test.ts:L124-136` (an exact `toEqual` of the entry, plus
  `resolveFlags({}).judge_sonnet` `false`) and `src/cli/Cli.test.ts:L1323`, the
  `GTD_FLAG_JUDGE_SONNET: ""` case of `flag %j passes no defaultModel`. An empty
  value falls back to `defaultOn`, so after rollout this case resolves on.
- Invariant: the rollout workflow lets a rollout change exactly one thing, the
  entry's `defaultOn: true`. Its guard refuses any other path, after the agent's
  turn and also after a human's fix at `rollout.suite.blocked`. Tests pin this:
  `src/workflows/rollout/rollout.feature` "a turn also changing a source file is
  refused" and "a human fix at the blocked gate that also edits a source file is
  refused". The suite gate then has to go green with only the registry edited.
- Effect: once `gtd --workflow rollout --var flag=judge_sonnet` sets
  `defaultOn: true`, all three tests go red in every test-states pass. They are
  unit tests that pass their env explicitly, so the runner's ambient pin does
  not reach them. The process stops at `rollout.suite.blocked`, and the only fix
  (editing those tests) is a stray the guard refuses. Concern 3, run rollout
  then cleanup on this branch, can't be carried out without the human going
  around gtd.
- Fix: keep only assertions that hold in both registry states. Use
  `toMatchObject({ kind: "release" })`, as `risk_tier` does, or drop the shape
  test (test-audit already flagged it). Pin on/off only with an explicit
  `GTD_FLAG_JUDGE_SONNET` of `1`/`0`, never `{}` or `""`. The `@inmem` scenarios
  already pin explicitly and survive rollout.
- Also, non-blocking, same cause: the help text (`Cli.ts:L244-245`, `L677-678`),
  `docs/cli.md`, README and `docs/driver.md` all say the default is "haiku
  (sonnet under GTD_FLAG_JUDGE_SONNET=1)". After rollout that is false: the
  default is sonnet with the variable unset, and rollout is not allowed to touch
  those files. Cleanup's `GTD_FLAG_JUDGE_SONNET` literal scan will catch the two
  help strings, but nothing makes cleanup revisit the docs or regenerate the
  pinned `docs/cli.md` block. Release happens only after cleanup, so this never
  ships. It does make the docs wrong between rollout and cleanup, so cleanup's
  task should list the docs as well.
