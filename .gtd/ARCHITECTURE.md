# Architecture

Source: pmelab/gtd#355 — ship the `llm` judge's default-model swap (`haiku` →
`sonnet`) behind the release flag `judge_sonnet`, and make `rollout` and
`cleanup` startable here so the later two processes can run on this branch.

**The flag is read once, in `src/cli/Cli.ts`, and travels to the judge as plain
data (`defaultModel`).** `src/judges/` may not import `src/flags/`
(dependency-cruiser `flags-only-at-composition-points` and the
tools-import-only- contracts rule), and the `@inmem` tier wires `runJudge`
directly in `tests/integration/support/world.ts`, bypassing `src/program.ts` —
so a read in `src/program.ts` would be invisible to every `@inmem` scenario.
`Cli.ts` is an allowed composition point and sits on both tiers' path.

**The read uses the shipped registry, `resolveFlags(env).judge_sonnet`, not the
injectable `io.flags`.** Against `io.flags` (`readonly FlagDeclaration[]`) the
result is string-keyed, so the read would still compile after cleanup deletes
the registry entry and would silently fall back to `haiku`. Typed against
`FLAGS`, deleting the entry turns the read into a compile error cleanup must
resolve. A short comment at the read names `GTD_FLAG_JUDGE_SONNET` so cleanup's
literal scan finds the site. Rollout's `defaultOn: true` edit lands in that same
registry, so the rolled-out state resolves on with the variable unset.

**`defaultModel` is a last resort below every model layer and never selects a
provider.** It is applied after `selectJudge`/auto selection: passed to `llm` as
`model ?? defaultModel`. Folding it into the layers instead would break two
things — `TYPESAFE_API_KEY` auto selection (a set model forces llm) and the
pairing check (a model with `jev`/`fixed` is refused). Flag off, Cli.ts passes
nothing and `llm.ts`'s `DEFAULT_MODEL = "haiku"` applies unchanged. Cleanup
later flips `DEFAULT_MODEL` to `"sonnet"` and deletes the Cli.ts branch.

**Risk: once rolled out, every `llm` judge call for users with no pinned model
runs on `sonnet` — slower and costlier.** Docs state it.

**Risk: while the flag is on, `gtd judge run --provider llm` (sonnet) and the
Claude Code mod's judge subagent (`GTD_JUDGE_MODEL` or hard-coded `haiku`) send
the same prompt to different models.** No `claude/` code or test changes; docs
state the divergence beside the flag-dependent default.

**Risk: `judge_sonnet` adds a full vitest pass per gate and in CI** —
`scripts/test-states.ts` flips every release flag automatically; gate time grows
until cleanup.

Concern 2 (TECHNICAL): `gtd.config.ts` adds `rollout` and `cleanup` to its
`@pmelab/gtd/workflows` imports as `export const rollout = shippedRollout()` /
`export const cleanup = shippedCleanup()` (factory defaults, registry
`src/flags/index.ts`) and drops the "stay out until a release ships them"
comment. PATH gtd is 27.6.0; both shipped in 27.2.0.

Concern 3 (PRODUCT): nothing built here. Later, on this branch:
`gtd --workflow rollout --var flag=judge_sonnet`, then
`gtd --workflow cleanup --var flag=judge_sonnet`. One PR, merge commit or rebase
— **never squash**, or the flag/rollout/cleanup commits collapse into one and
the acceptance line fails. **The flag never ships default-off in a release**;
rollout is simulated.

Concerns 4+5 (PRODUCT, merged): the last package of this process files friction
issues with `gh`. **This process runs `flag_naive_pass=0` and
`flag_risk_tier=0`, so no `seam.judge` and no `Gtd-Mark: risk-tier` trailers
land — "trailers for every gate" is only partly met; file that gap as a friction
issue, never omit it silently.**

## Interfaces

```ts
// src/flags/index.ts — new registry entry (default off: no defaultOn)
export const FLAGS = [
  {
    name: "naive_pass",
    owner: "pmelab",
    expiry: "2027-01-15",
    kind: "release",
  },
  { name: "risk_tier", owner: "pmelab", expiry: "2027-01-15", kind: "release" },
  {
    name: "judge_sonnet",
    owner: "pmelab",
    expiry: "2027-01-15",
    kind: "release",
  },
] as const satisfies readonly FlagDeclaration[]
```

```ts
// src/cli/Program.ts — Command's judgeRun variant
| {
    readonly kind: "judgeRun"
    readonly provider?: "fixed" | "jev" | "llm"
    readonly answers?: string
    readonly model?: string
    /** Set by runCli from GTD_FLAG_JUDGE_SONNET, never parsed from argv. */
    readonly defaultModel?: string
  }

// src/cli/ToolCommands.ts — JudgeRequest, forwarded unchanged by runJudgeRunCommand
interface JudgeRequest {
  // …existing fields…
  readonly defaultModel?: string | undefined
}

// src/cli/Cli.ts — runCli, after flags resolve and before runCommand:
// a judgeRun command gains defaultModel "sonnet" when
// resolveFlags(env).judge_sonnet (shipped FLAGS registry) is true; otherwise
// the command passes through untouched (no defaultModel key).
```

```ts
// src/judges/run.ts
export interface RunJudgeInput {
  // …existing fields…
  /**
   * The llm's last-resort model, below --model, GTD_JUDGE_MODEL and
   * judge.json. Never selects a provider and never trips the pairing check.
   */
  readonly defaultModel?: string | undefined
}
// answererFor: return llm({ env, cwd, model: model ?? opts.defaultModel, io })
// src/judges/providers/llm.ts: unchanged; DEFAULT_MODEL stays "haiku".
```

## Call Stacks

- `gtd judge run` → `src/cli/Cli.ts` `runCli` (resolves `FLAGS` from `Host.env`;
  `judge_sonnet` on → `defaultModel: "sonnet"` on the judgeRun command)
- → `src/cli/Program.ts` `runJudgeRunCommand` (forwards `defaultModel` into the
  `JudgeRequest`)
- → `ToolCommands.judge`: live `src/program.ts`; `@inmem`
  `tests/integration/support/world.ts` — both call `runJudge(request)`
- → `src/judges/run.ts` `runJudge` → `answererFor` (`selectJudge` picks provider
  and model from flag/env/file; `defaultModel` is not a layer)
- → `src/judges/providers/llm.ts` `llm({ model: model ?? defaultModel })` →
  `claude -p --model <model>`

## E2E Scenarios

- e2e: tests/integration/features/judge-run.feature — with
  `GTD_FLAG_JUDGE_SONNET` `0` and no model configured,
  `gtd judge run --provider llm` runs claude with `--model haiku` (covers 1)
- e2e: tests/integration/features/judge-run.feature — with
  `GTD_FLAG_JUDGE_SONNET` `1` and no model configured,
  `gtd judge run --provider llm` runs claude with `--model sonnet` and the
  verdict round-trips through `gtd judge answer` (covers 1)
- e2e: tests/integration/features/judge-run.feature — with
  `GTD_FLAG_JUDGE_SONNET` `1` and `GTD_JUDGE_MODEL` `haiku`, claude runs with
  `--model haiku` (covers 1)
- e2e: tests/integration/features/judge-run.feature — with
  `GTD_FLAG_JUDGE_SONNET` `1`, `--model opus` runs claude with `--model opus`
  (covers 1)

All four tagged `@inmem`, each pinning `GTD_FLAG_JUDGE_SONNET` explicitly with
the existing `an environment variable … set to …` step, so the runner's per-flag
passes cannot flip them.

## Unit Tests

### src/flags/index.ts FLAGS — judge_sonnet entry

- unit: src/flags/index.test.ts — `judge_sonnet` is declared `kind: "release"`,
  owner `pmelab`, expiry `2027-01-15`, no `defaultOn`; `resolveFlags({})` leaves
  it off and `GTD_FLAG_JUDGE_SONNET=1` turns it on (covers 1)

### src/cli/Program.ts Command judgeRun.defaultModel / src/cli/ToolCommands.ts JudgeRequest.defaultModel / src/cli/Cli.ts runCli

- unit: src/cli/Cli.test.ts — `runCli` of `gtd judge run` with
  `GTD_FLAG_JUDGE_SONNET=1` hands the stubbed `ToolCommands.judge` a request
  with `defaultModel: "sonnet"` (covers 1)
- unit: src/cli/Cli.test.ts — with `GTD_FLAG_JUDGE_SONNET` `0` or unset the
  request carries no `defaultModel` (covers 1)
- unit: src/cli/Cli.test.ts — with the flag on, `--model opus` still reaches the
  request as `model: "opus"` beside `defaultModel: "sonnet"` (covers 1)
- unit: src/cli/Cli.test.ts — `parseArgv` of `judge run` never sets
  `defaultModel` (covers 1)

### src/judges/run.ts RunJudgeInput.defaultModel

- unit: src/judges/run.test.ts — with no `--model`, `GTD_JUDGE_MODEL` or
  `judge.json` model, `defaultModel: "sonnet"` reaches claude's argv as
  `--model sonnet` (covers 1)
- unit: src/judges/run.test.ts — `--model`, `GTD_JUDGE_MODEL` and a `judge.json`
  `model` each beat `defaultModel` (covers 1)
- unit: src/judges/run.test.ts — `defaultModel` with `TYPESAFE_API_KEY` set and
  no provider still auto-selects jev and never runs claude (covers 1)
- unit: src/judges/run.test.ts — `defaultModel` with `--provider jev` or `fixed`
  raises no "a model only applies to provider llm" error (covers 1)
- unit: src/judges/providers/llm.test.ts — existing "defaults to haiku" case
  stays green unchanged: flag-off default (covers 1)

### Chores

- chore: src/cli/Cli.ts — `--model` help ("GTD_JUDGE_MODEL, then judge.json,
  then haiku") and the `judge run` summary ("model haiku unless --model") name
  the flag-dependent default: `haiku`, `sonnet` under `GTD_FLAG_JUDGE_SONNET`
  (covers 1)
- chore: docs/cli.md — regenerate the pinned `## Commands` block from
  `renderHelp()` after the help change; `Cli.test.ts` fails otherwise (covers 1)
- chore: README.md — the two `haiku` mentions (llm provider, auto-selection
  summary) state the flag-dependent default, the slower/costlier `sonnet` once
  rolled out for users with no pinned model, and that the mod's judge subagent
  stays on `haiku` while the flag is on (covers 1)
- chore: docs/driver.md — llm-provider paragraph ("defaults to `haiku`") and the
  calibration-risk paragraph ("every user of the paste has `haiku`") state the
  flag-dependent default and the cost/latency rise; the mod judge-gate bullet
  ("haiku by default") notes the model divergence while the flag is on
  (covers 1)
- chore: gtd.config.ts — import and export `rollout` and `cleanup` from
  `@pmelab/gtd/workflows` with factory defaults; delete the "stay out until a
  release ships them" comment (covers 2)
- chore: gtd.config.ts — nothing built for rollout/cleanup in this process; they
  run later on this branch as `gtd --workflow rollout --var flag=judge_sonnet`
  then `gtd --workflow cleanup --var flag=judge_sonnet`, one PR, merge commit or
  rebase, never squash (covers 3)
- chore: GitHub issues labelled `track:dogfood` — last package:
  `gh issue list --label track:dogfood --state open` first, comment on a match,
  else `gh issue create` one issue per friction point hit in this process, each
  referencing #355; one of them records the missing `seam.judge` and
  `Gtd-Mark: risk-tier` trailers from running with `flag_naive_pass=0` and
  `flag_risk_tier=0` (covers 4, 5)

## Merged Concerns

### 4 + 5 → one friction-filing package

Both center on the same footprint — `track:dogfood` GitHub issues filed in this
process's last package; concern 4's gap is one of concern 5's issues.

Concern 4 verbatim:

> ### 4. Gate coverage: default workflow only (PRODUCT)
>
> - This process keeps `flag_naive_pass=0` and `flag_risk_tier=0`.
> - **"Trailers for every gate" is only partly met: no `seam.judge` and no
>   `Gtd-Mark: risk-tier` trailers will land.** Record that gap as a friction
>   follow-up, not a silent omission.

Concern 5 verbatim:

> ### 5. Friction follow-ups, filed by the agent (PRODUCT)
>
> - Last package of each of the three processes (this one, rollout, cleanup):
>   one `gh issue` per friction point hit during that process, labelled
>   `track:dogfood`, referencing #355.
> - Search open `track:dogfood` issues first and comment on a match instead of
>   filing a duplicate.
> - They feed #356 (SDLC docs), which this issue blocks.

## Answered Questions

### Where is `judge_sonnet` read?

In `src/cli/Cli.ts` `runCli`: the only allowed flag-import site on both the live
and `@inmem` paths; `src/judges/` may not import flags and `src/program.ts` is
bypassed in `@inmem`.

### Against which registry is the flag resolved for the judge?

The shipped `FLAGS` via `resolveFlags(env)`: typed keys make cleanup's registry
deletion a compile error at the read instead of a silent fallback to `haiku`.

### How does the flag reach the llm provider?

As data — an optional `defaultModel` on the judgeRun command, `JudgeRequest` and
`RunJudgeInput` — keeping `src/judges/` flag-agnostic and letting cleanup delete
one branch.

### Is `defaultModel` a fourth model layer in `selectJudge`?

No. It applies after selection as `model ?? defaultModel`; as a layer it would
force llm over keyed jev auto selection and trip the jev/fixed pairing refusal.

### Does the flag need a pinned `flag_judge_sonnet` workflow var or trailer?

No. Judging is not replayed and the settled requirement reads the live env; no
workflow branches on it.

### Does the new flag need test-runner or CI wiring?

No. `scripts/test-states.ts` builds a pass per release flag from `FLAGS`, and
`scripts/lint-flags.ts` accepts `GTD_FLAG_JUDGE_SONNET` once it is registered.

### How is `docs/cli.md` kept in sync?

By pasting the regenerated `renderHelp()` output into its `## Commands` block;
there is no generator script, and `Cli.test.ts` pins the two equal.
