# Review: a057e71

<!-- base: 3748c0edc35f238e82a6f6e1db9aff87c93d5558 -->

Retires release flag `judge_sonnet`: `sonnet` is now the `llm` answerer's
permanent default model. **No reference to `judge_sonnet`,
`GTD_FLAG_JUDGE_SONNET` or `defaultModel` survives outside `.gtd/`.** No
`.gtd/REQUIREMENTS.md` exists for this cleanup.

## Scenarios

- [ ] ./tests/integration/features/judge-run.feature#285-303 — Weakened: drops
      the `GTD_FLAG_JUDGE_SONNET=1` Given and `, with judge_sonnet on` from the
      name. Both `Then it succeeds` lines and
      `the last commit subject is "gtd(judge): review → conservative"` still run
      under the new name; nothing is lost but the flag pin. No
      `.gtd/REQUIREMENTS.md` asked for the flag-on variant. Pins: no
      `--provider` plus a non-empty `TYPESAFE_API_KEY` answers through jev,
      never claude.
- [ ] ./tests/integration/features/judge-run.feature#322-337 — Weakened:
      replaces both flag scenarios. Scenario "judge_sonnet on makes sonnet the
      llm default…" is renamed; its two `Then it succeeds`, `review → confident`
      subject and `claude was run with "--model sonnet"` survive here. Scenario
      "judge_sonnet off keeps haiku as the llm default" is deleted: **its two
      `Then it succeeds`, its `review → confident` subject and
      `claude was run with "--model haiku"` are gone for good** — the haiku
      branch no longer exists, so this loss is intended. No
      `.gtd/REQUIREMENTS.md` asked for either. Pins: `--provider llm` with no
      model configured calls claude with `--model sonnet` and the verdict lands.

## Flag removal

Deletes the registry entry and the CLI's one consumer, which injected
`defaultModel: "sonnet"` into `judgeRun` commands.

- [ ] ./src/flags/index.ts#16-19 — drops `judge_sonnet` from `FLAGS`; the test
      runner loses one per-flag vitest pass.
- [ ] ./src/flags/index.test.ts#115-121 — deletes the "is a release flag" test.
- [ ] ./src/cli/Cli.ts#1465-1476 — `runCli` back to resolving flags only and
      passing `plan.command` through untouched; the compile-guard comment goes
      with it.

## defaultModel plumbing removed

`defaultModel` existed only to carry the flag's value; the default now lives in
the answerer itself.

- [ ] ./src/cli/Program.ts#175-180 — drops `defaultModel` from the `judgeRun`
      command type.
- [ ] ./src/cli/Program.ts#435-442 — stops forwarding it to the judge request.
- [ ] ./src/cli/ToolCommands.ts#18-25 — drops it from `JudgeRequest`.
- [ ] ./src/judges/run.ts#14-20 — drops it from `RunJudgeInput`.
- [ ] ./src/judges/run.ts#116-123 — `llm` now receives only the resolved
      `model`; an unset model falls through to the answerer's own default.

## Default model haiku → sonnet

- [ ] ./src/judges/providers/llm.ts#13-13 — `DEFAULT_MODEL` becomes `"sonnet"`.
      **Every unpinned `llm` judge call gets slower and costlier** — the flag
      already shipped default-on, so behaviour for users is unchanged.
- [ ] ./src/judges/providers/llm.test.ts#106-118 — default-model unit test now
      expects `--model sonnet`.

## Model-precedence unit tests

Deletes the `runJudge defaultModel` block (4 tests); folds its surviving
precedence checks into the judge.json block.

- [ ] ./src/judges/run.test.ts#89-117 — new `argvShim`/`run` helpers; the
      judge.json test now asserts `--model file` reaches claude's argv instead
      of only the verdict, and a new test pins `GTD_JUDGE_MODEL` over
      judge.json. Lost with the deleted block: `--model` beating a lower
      default, jev auto-selection staying on with a default present, and the
      `fixed` pairing check — the first two remain covered by the
      `--model reaches claude's argv` and jev scenarios; the last guarded only
      `defaultModel` and is moot.

## Docs

- [ ] ./README.md#416-426 — step text: llm model is `sonnet`, flag mention
      removed.
- [ ] ./README.md#432-439 — auto-selection note: default sonnet; the mod's judge
      subagent still runs `haiku`.
- [ ] ./docs/cli.md#169-169 — pinned `judge run` help row now says
      `model sonnet unless --model`.
- [ ] ./docs/cli.md#241-241 — pinned `--model` option row ends `then sonnet`.
- [ ] ./src/cli/Cli.ts#244-244 — source of that `--model` help row.
- [ ] ./src/cli/Cli.ts#676-676 — source of that `judge run` help row.
- [ ] ./docs/driver.md#378-383 — mod section: subagent haiku vs `--provider llm`
      sonnet — **the two now permanently judge on different models**.
- [ ] ./docs/driver.md#852-855 — llm provider paragraph: default `sonnet`.
- [ ] ./docs/driver.md#865-870 — calibration risk: paste users get `sonnet` or
      jev answering gates unattended.
