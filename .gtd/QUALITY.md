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
