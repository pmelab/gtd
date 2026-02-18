# Per-Mode Model Selection

## Action Items

### Rename Config Fields and Add Model Support

- [x] Rename `agentPlan`/`agentBuild`/`agentLearn` to
      `modelPlan`/`modelBuild`/`modelLearn` and add `modelCommit` in config
  - Update `ConfigSchema.ts`: replace the three `agent*` fields with `model*`
    fields (type `Schema.optional(Schema.String)`), add `modelCommit` field
  - Update `Config.ts` interface: rename fields to `modelPlan`, `modelBuild`,
    `modelLearn`, add `modelCommit`
  - Update `ConfigResolver.ts` defaults: all model fields default to `undefined`
    (agent uses its own default model when unset)
  - Keep backwards compat: strip old `agentPlan`/`agentBuild`/`agentLearn`
    fields in `mergeConfigs` (ignore, don't reject)
  - Update `test-helpers.ts` default config
  - Tests: `ConfigSchema.test.ts` — old fields are silently ignored, new
    `model*` fields (including `modelCommit`) parse correctly;
    `ConfigResolver.test.ts` — defaults and merging work; `Config.test.ts` —
    resolved config has new field names

### Pass Model to AgentInvocation

- [ ] Add `model` field to `AgentInvocation` interface

  - Add `readonly model?: string` to `AgentInvocation` in `Agent.ts`
  - Tests: existing `Agent.test.ts` still passes with `model` undefined

- [ ] Wire `AgentService.Live` to resolve model per mode from config
  - In `AgentService.Live`, look up
    `config.modelPlan`/`modelBuild`/`modelLearn`/`modelCommit` based on
    `params.mode` and pass as `model` to the underlying provider
  - When unset, pass `undefined` so the agent uses its own default model
  - Tests: `Agent.test.ts` — when `modelPlan` is set, invocations with
    `mode: "plan"` receive the configured model; when `modelCommit` is set,
    commit invocations receive that model; when unset, model is `undefined`

### Agent Providers Pass Model to CLI

- [ ] Pi agent: pass `--model` flag when `params.model` is set

  - In `Pi.ts` `spawn`, conditionally add `["--model", params.model]` to args
  - Tests: `Pi.test.ts` — spawn args include `--model <value>` when model is
    provided, omit when undefined

- [ ] OpenCode agent: pass `--model` flag when `params.model` is set

  - In `OpenCode.ts` `spawn`, conditionally add `["-m", params.model]` to args
  - Tests: `OpenCode.test.ts` — spawn args include `-m <value>` when model is
    provided, omit when undefined

- [ ] Claude agent: pass `--model` flag when `params.model` is set
  - In `Claude.ts` `buildClaudeArgs`, conditionally add
    `["--model", params.model]` to args
  - Tests: `Claude.test.ts` — `buildClaudeArgs` includes `--model <value>` when
    model is provided, omit when undefined

### Update Example Config and Schema

- [ ] Update `EXAMPLE_CONFIG` in `ConfigResolver.ts` with
      `modelPlan`/`modelBuild`/`modelLearn`/`modelCommit` examples
  - Add commented-out or explicit model entries like `"modelPlan": "sonnet"`,
    `"modelBuild": "opus"`, `"modelCommit": "haiku"`
  - Regenerate `schema.json` if applicable
  - Tests: `readme.test.ts` — example config is valid; snapshot tests still pass

### Update RunInfo Banner

- [ ] Display resolved model per mode in the run info banner
  - Show which model will be used for the current command's mode
  - Tests: `RunInfo.test.ts` / `run-info-banner.test.ts` — banner includes model
    info when configured

## Learnings

- When renaming config fields, keep backwards compatibility by ignoring (not
  rejecting) the old field names in parsing so existing config files don't break
- When changing defaults, update all three layers: the defaults object, any
  hardcoded fallbacks in function signatures, and all test assertions that
  reference the old default
- Agent providers should accept optional parameters and only pass CLI flags when
  values are explicitly set — never pass empty strings or defaults that override
  the agent's own configuration
- Prefer per-mode defaults over a single fallback field — let each agent use its
  own default model when no override is configured, rather than forcing a
  universal fallback
