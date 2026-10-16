# Review: ee7dc97

<!-- base: f5b4ffce66fb74941df45dcb8bb72b19f42fb98d -->

**No defects found.** The `judge_sonnet` release flag moves only the `llm`
judge's last-resort default from `haiku` to `sonnet`. `rollout` and `cleanup`
become startable here. Two task-list unit cases are missing; their behaviour is
covered elsewhere.

## Scenarios

- [ ] ./tests/integration/features/judge-run.feature#285-305 — with the flag on
      and `TYPESAFE_API_KEY` set, auto selection still picks jev and never runs
      claude (verdict `conservative`, not claude's `confident`)
- [ ] ./tests/integration/features/judge-run.feature#306-322 — Weakened: lost
      `And claude was run with "--model sonnet"`; now asserts `--model opus`.
      `.gtd/REQUIREMENTS.md` did not ask for `sonnet` here. **The swap is
      needed: under the flag `sonnet` is the default, so `sonnet` in argv no
      longer proves `--model` reached claude.**
- [ ] ./tests/integration/features/judge-run.feature#323-340 — flag explicitly
      `0`: `--provider llm` with no pinned model runs claude with
      `--model haiku`
- [ ] ./tests/integration/features/judge-run.feature#341-358 — flag `1`:
      `--provider llm` with no pinned model runs claude with `--model sonnet`
      and the verdict lands

## Register the `judge_sonnet` release flag

A new registry entry, default off. The rollout and cleanup workflows find it
there.

- [ ] ./src/flags/index.ts#19-19 — `judge_sonnet`, release, owner pmelab, expiry
      2027-01-15, no `defaultOn`
- [ ] ./src/flags/index.test.ts#122-127 — pins the entry's `kind` only. **Gap:
      the package asked for `resolveFlags({})` off and `GTD_FLAG_JUDGE_SONNET=1`
      on.** The generic resolver tests and both flag-state scenarios cover that
      behaviour. **Every release flag adds one full vitest pass to every gate
      and to CI until cleanup.**

## `defaultModel`: a last-resort model below every configured one

`runJudge` takes an optional `defaultModel`. It applies only after provider
selection and only to `llm`, so it never selects a provider. It never trips the
model-needs-llm pairing check either.

- [ ] ./src/judges/run.ts#18-19 — new optional input
- [ ] ./src/judges/run.ts#124-124 — `model ?? opts.defaultModel`, passed only to
      `llm`. `--model`, `GTD_JUDGE_MODEL` and `judge.json` have already filled
      in `model` by this point, so they win
- [ ] ./src/judges/run.test.ts#155-239 — a shim records claude's argv. Pinned:
      `defaultModel` applies when no layer sets a model; `--model`, env and
      judge.json each beat it; jev auto-selection still wins with
      `TYPESAFE_API_KEY`; `--provider fixed` gives no pairing error. **Gap: the
      package also listed `--provider jev` + `defaultModel` (no pairing error);
      only `fixed` is tested.** Both go through the same `model` check, so this
      is low risk

## Thread the flag through the CLI

The flag is read once in `runCli` from the live env against the shipped
registry. A `judgeRun` command then gets `defaultModel: "sonnet"`. Judging is
never replayed, so reading the live value is allowed.

- [ ] ./src/cli/Cli.ts#1467-1486 — `resolveFlags(env).judge_sonnet` is checked
      only when the command is `judgeRun`. The comment explains why it uses
      `FLAGS` and not `io.flags`: deleting the entry then fails to compile here.
      Flag off adds no `defaultModel` key. No `Cli.test.ts` case covers this
      wiring; the four scenarios above do
- [ ] ./src/cli/Program.ts#180-180 — `Command` judgeRun gains `defaultModel`;
      `parseArgv` never sets it
- [ ] ./src/cli/Program.ts#441-441 — forwarded into the judge request
- [ ] ./src/cli/ToolCommands.ts#23-23 — `JudgeRequest.defaultModel`

## Help text and docs for the flag-dependent default

These state the flag's two risks. **Rolled out, every `llm` call with no pinned
model gets slower and costlier.** **With the flag on, `gtd judge run` uses
`sonnet` while the Claude Code mod's judge subagent stays on `haiku`.** The
`docs/cli.md` blocks are pinned to the rendered help.

- [ ] ./src/cli/Cli.ts#244-245 — `--model` help: haiku, or sonnet under the flag
- [ ] ./src/cli/Cli.ts#677-678 — `gtd judge run` help: same
- [ ] ./docs/cli.md#169-170 — regenerated Commands block
- [ ] ./docs/cli.md#242-243 — regenerated Options block
- [ ] ./README.md#419-427 — llm provider default under the flag
- [ ] ./README.md#435-440 — auto selection default, and that the mod's subagent
      stays on `haiku`
- [ ] ./docs/driver.md#379-381 — mod subagent vs `gtd judge run` run on
      different models while the flag is on
- [ ] ./docs/driver.md#855-857 — llm default plus the slower/costlier warning
- [ ] ./docs/driver.md#870-873 — calibration-risk paragraph names `sonnet` under
      the flag

## Make `rollout` and `cleanup` startable in this repo

The hold-back comment is gone. Both workflows shipped in v27.2.0, and the PATH
gtd is on 27.6.0, so this repo's `gtd.config.ts` can import them.

- [ ] ./gtd.config.ts#1-17 — exports `rollout` and `cleanup`; drops the stale
      comment
- [ ] ./tests/tooling/package-exports.test.ts#85-85 — expected workflow names
      now include `cleanup` and `rollout`
