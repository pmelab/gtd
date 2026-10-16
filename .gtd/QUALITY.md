## correctness: judge model precedence lost its only argv test

The removed `runJudge defaultModel` block in `src/judges/run.test.ts` held the
one test that checked `GTD_JUDGE_MODEL` and a `judge.json` `model` actually
reach claude's `--model` argv (the
`loses to --model, GTD_JUDGE_MODEL and judge.json` case). What is left does not
check it: `layers per field` uses a shim that ignores its args and only checks
the verdict, and the feature scenarios check `--model opus` (flag) and
`--model sonnet` (default) only. Drop `model: env["GTD_JUDGE_MODEL"]` from the
env layer in `selectJudge`, or ignore the file's model, and every test still
passes.

Fix: keep the argv-recording shim and rewrite that case without `defaultModel`.
Assert `--model env-model` when `GTD_JUDGE_MODEL` is set and `--model file` when
only judge.json sets a model. Optionally add an env-beats-file case. The
`does not stop jev auto-selection` case also lost its reason to exist once
`defaultModel` went, so dropping it is fine.

## ponytail-review: leftovers from the judge_sonnet removal

- `src/cli/Cli.ts:L1468-1477`: shrink: `Effect.try` still builds
  `{ flags, command: plan.command }` only to pass `plan.command` through
  unchanged. Use `Effect.try({ try: () => resolveFlags(env, io.flags), catch })`
  then `Effect.flatMap((flags) => runCommand(plan.command, plan.json, out)...)`.
- `src/judges/run.ts:L122`: shrink: `model: model`. Use the shorthand `model`.
- `src/cli/Cli.ts:L676-677` (and its pinned copy in `docs/cli.md:L169-170`):
  shrink: `"on PATH (Claude Code only), model sonnet"` / `"unless --model."`
  wrap early after the text was cut. Join them into one line,
  `on PATH (Claude Code only), model sonnet unless --model.`, which still fits
  the width.

net: -4 lines possible.

## test-audit: hollow model-layer test, now-redundant default scenario

- `src/judges/run.test.ts`
  `layers per field: a flag provider with the file's model`: its name promises
  more than it checks. The shim ignores its argv and only the verdict is
  checked, so it still passes if `selectJudge` drops the file's `model`. It was
  hollow before too, but the deleted `runJudge defaultModel` cases used to cover
  for it. Now nothing does (see the correctness chunk). Fix in the same change:
  point this test at the argv-recording shim and assert `--model file`, instead
  of adding another near-duplicate test.
- `tests/integration/features/judge-run.feature`
  `sonnet is the llm default and the verdict round-trips`: non-blocking. The
  scenario existed because the default used to be wired in the CLI
  (`judge_sonnet` → `defaultModel`). That wiring is gone. The default is now
  `DEFAULT_MODEL` in the llm provider, and `src/judges/providers/llm.test.ts`
  `defaults to sonnet, …` already owns it at that boundary. The round-trip half
  repeats `--model reaches claude's argv`. Keeping it is acceptable as the
  user-facing default pinned end to end, but it now covers no risk of its own.
  You could drop it, or fold `claude was run with "--model sonnet"` into an
  existing `--provider llm` scenario.
- Removals checked and OK: `judge_sonnet` `is a release flag` only restated the
  registry entry. `does not stop jev auto-selection` is a duplicate of
  `auto selects jev when keyed and never falls back to the llm` plus the jev
  feature scenario. `does not trip the pairing check for provider fixed` has no
  subject now that `defaultModel` is gone.
