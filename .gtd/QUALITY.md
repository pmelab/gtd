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
