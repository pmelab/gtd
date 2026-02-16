# Run Info Banner

gtd should report on each run which agent and mode is being used, and any other
useful information that is derived from the environment.

## Action Items

### Add agent name to resolution result

- [ ] Extend `AgentProvider` with a `readonly name: string` field
  - Add `name` to the `AgentProvider` interface in `Agent.ts`
  - Set `name` in each concrete agent: `PiAgent`, `OpenCodeAgent`, `ClaudeAgent`
  - For `auto` mode, set `name` to the first available agent's name (e.g.
    `"pi (auto)"`)
  - Tests: Unit test that each agent provider exposes the correct `name`; test
    that `auto` resolution includes `"(auto)"` suffix

- [ ] Surface resolved agent name from `AgentService.invoke`
  - Change `AgentService` so the resolved provider's `name` is accessible
    before/after invoke (e.g. add a `resolvedName` field or return it alongside
    `AgentResult`)
  - Alternatively, expose a `resolve` method on `AgentService` that returns
    `{ name, invoke, isAvailable }`
  - Tests: Integration test that `AgentService` exposes the resolved agent name
    given a config with `agent: "auto"` and mocked availability

### Add run info banner to CLI output

- [ ] Create a `RunInfo` type capturing environment-derived metadata
  - Fields: `agent` (resolved name), `step` (inferred step like
    plan/build/learn/cleanup/idle), `planFile` (config file path),
    `configSources` (list of loaded config filepaths)
  - Define in a new `src/services/RunInfo.ts` or inline in `cli.ts`
  - Tests: Type-level only — ensure the type is used in the banner renderer

- [ ] Render the run info banner at the start of each run
  - After `gatherState` and `dispatch` in the root command, print a short banner
    to stderr (so it doesn't interfere with piped stdout)
  - Format example:
    `[gtd] agent=pi (auto) step=build file=TODO.md configs=.gtdrc.json,~/.config/gtd/.gtdrc.json`
  - Use `Console.error` or `process.stderr.write` so it doesn't pollute stdout
  - Tests: Capture stderr output in CLI integration test; verify banner contains
    agent name, step, and file path

### Expose config sources from resolver

- [ ] Return loaded config filepaths from `GtdConfigService`
  - `mergeConfigs` already receives config results with `filepath` — propagate
    the list of filepaths into the merged config or a sidecar value
  - Option A: Add `readonly configSources: ReadonlyArray<string>` to `GtdConfig`
  - Option B: Return a tuple `[GtdConfig, string[]]` from the layer and store
    sources separately
  - Tests: Unit test `mergeConfigs` returns source paths; integration test that
    `GtdConfigService` exposes which files were loaded

> addition: if not --quiet, output should also log the full decision tree on
> each invocation (feedback, plan, build ...)

## Open Questions

- Should the banner be suppressible via a `--quiet` flag or config option?
  > yes
- Should the banner include the git branch or working directory path?
  > no

## Learnings

- Always write environment/debug info to stderr so it doesn't break piped output
  or downstream tooling
