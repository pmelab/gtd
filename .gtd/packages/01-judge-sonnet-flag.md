# 01 — `judge_sonnet` release flag: llm judge default `haiku` → `sonnet`

## Requirement

Concern 1 (pmelab/gtd#355): ship the `llm` judge's default-model swap (`haiku` →
`sonnet`) behind the release flag `judge_sonnet`, default off. See
`.gtd/ARCHITECTURE.md` (Interfaces, Call Stacks).

- **The flag is read once, in `src/cli/Cli.ts` `runCli`, via
  `resolveFlags(env).judge_sonnet` against the shipped `FLAGS` registry — never
  `io.flags`, never in `src/judges/` or `src/program.ts`.**
- **`defaultModel` is a last resort below `--model`, `GTD_JUDGE_MODEL` and
  `judge.json`; it never selects a provider and never trips the jev/fixed
  pairing check.**
- Flag off: no `defaultModel` key anywhere; `llm.ts` `DEFAULT_MODEL = "haiku"`
  unchanged.
- **Risk: rolled out, every `llm` judge call with no pinned model runs `sonnet`
  — slower, costlier.** Docs state it.
- **Risk: flag on, `gtd judge run --provider llm` (sonnet) and the mod's judge
  subagent (`haiku`) judge on different models.** No `claude/` change; docs
  state it.
- **Risk: one more full vitest pass per gate and in CI until cleanup.**

## Tasks

### 1. Register the flag

Paths: `src/flags/index.ts`, `src/flags/index.test.ts`

- [ ] `FLAGS` gains
      `{ name: "judge_sonnet", owner: "pmelab", expiry: "2027-01-15", kind: "release" }`,
      no `defaultOn`
- [ ] Unit test: entry shape as declared; `resolveFlags({})` off;
      `GTD_FLAG_JUDGE_SONNET=1` on
- [ ] `scripts/lint-flags.ts` and `scripts/test-states.ts` pick it up with no
      edit

### 2. `defaultModel` in the judge

Paths: `src/judges/run.ts`, `src/judges/run.test.ts`,
`src/judges/providers/llm.test.ts`

- [ ] `RunJudgeInput.defaultModel?: string | undefined`; `answererFor` calls
      `llm({ env, cwd, model: model ?? opts.defaultModel, io })` after
      `selectJudge`
- [ ] Unit: no model layers set + `defaultModel: "sonnet"` → claude argv
      `--model sonnet`
- [ ] Unit: `--model`, `GTD_JUDGE_MODEL`, `judge.json` `model` each beat
      `defaultModel`
- [ ] Unit: `defaultModel` + `TYPESAFE_API_KEY`, no provider → jev
      auto-selected, claude never runs
- [ ] Unit: `defaultModel` + `--provider jev` or `fixed` → no "a model only
      applies to provider llm" error
- [ ] `llm.test.ts` "defaults to haiku" stays green unchanged; `llm.ts`
      untouched

### 3. Thread it through the CLI

Paths: `src/cli/Program.ts`, `src/cli/ToolCommands.ts`, `src/cli/Cli.ts`,
`src/cli/Cli.test.ts`

- [ ] `Command` judgeRun variant gains `defaultModel?: string`; `parseArgv`
      never sets it
- [ ] `JudgeRequest.defaultModel?: string | undefined`; `runJudgeRunCommand`
      forwards it
- [ ] `runCli`: judgeRun gains `defaultModel: "sonnet"` when
      `resolveFlags(env).judge_sonnet`; else passes through with no
      `defaultModel` key
- [ ] Short comment at the read names `GTD_FLAG_JUDGE_SONNET` (cleanup's literal
      scan finds it)
- [ ] Unit: flag `1` → stubbed `ToolCommands.judge` gets
      `defaultModel: "sonnet"`
- [ ] Unit: flag `0` or unset → no `defaultModel`
- [ ] Unit: flag on + `--model opus` → `model: "opus"` beside
      `defaultModel: "sonnet"`
- [ ] Unit: `parseArgv` of `judge run` never sets `defaultModel`
- [ ] `src/program.ts` and `tests/integration/support/world.ts` pass the request
      to `runJudge` unchanged (no flag import there)
- [ ] `npm run lint:boundaries` green: `src/judges/` imports nothing from
      `src/flags/`

### 4. E2E scenarios

Paths: `tests/integration/features/judge-run.feature`

All `@inmem`; each pins `GTD_FLAG_JUDGE_SONNET` with the existing
`an environment variable … set to …` step.

- [ ] Flag `0`, no model configured, `gtd judge run --provider llm` → claude
      `--model haiku`
- [ ] Flag `1`, no model configured → claude `--model sonnet`; verdict
      round-trips through `gtd judge answer`
- [ ] Flag `1`, `GTD_JUDGE_MODEL` `haiku` → claude `--model haiku`
- [ ] Flag `1`, `--model opus` → claude `--model opus`

### 5. Help and docs

Paths: `src/cli/Cli.ts`, `docs/cli.md`, `README.md`, `docs/driver.md`

- [ ] `--model` help and the `judge run` summary name the flag-dependent
      default: `haiku`, `sonnet` under `GTD_FLAG_JUDGE_SONNET`
- [ ] `docs/cli.md` `## Commands` block re-pasted from `renderHelp()`;
      `Cli.test.ts` pin green
- [ ] README: both `haiku` mentions (llm provider, auto-selection summary) state
      the flag-dependent default, the slower/costlier `sonnet` once rolled out
      for users with no pinned model, and the mod's judge subagent staying on
      `haiku` while the flag is on
- [ ] `docs/driver.md`: llm-provider paragraph and calibration-risk paragraph
      state the flag-dependent default and cost/latency rise; mod judge-gate
      bullet notes the model divergence while the flag is on
- [ ] No doc names a `src/*.ts` module or internal function (AGENTS.md)

### 6. Full suite

- [ ] `npm test` green in the base state and the `GTD_FLAG_JUDGE_SONNET=1` state

## Tests

- unit: `src/flags/index.test.ts`
- unit: `src/cli/Cli.test.ts`
- unit: `src/judges/run.test.ts`
- unit: `src/judges/providers/llm.test.ts`
- e2e: `tests/integration/features/judge-run.feature`
