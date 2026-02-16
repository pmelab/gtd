# Run Info Banner

gtd should report on each run which agent and mode is being used, and any other
useful information that is derived from the environment.

## Action Items

### Add agent name to resolution result

- [x] Extend `AgentProvider` with a `readonly name: string` field
  - Add `name` to the `AgentProvider` interface in `Agent.ts`
  - Set `name` in each concrete agent: `PiAgent`, `OpenCodeAgent`, `ClaudeAgent`
  - For `auto` mode, set `name` to the first available agent's name (e.g.
    `"pi (auto)"`)
  - Tests: Unit test that each agent provider exposes the correct `name`; test
    that `auto` resolution includes `"(auto)"` suffix

- [x] Surface resolved agent name from `AgentService.invoke`
  - Change `AgentService` so the resolved provider's `name` is accessible
    before/after invoke (e.g. add a `resolvedName` field or return it alongside
    `AgentResult`)
  - Alternatively, expose a `resolve` method on `AgentService` that returns
    `{ name, invoke, isAvailable }`
  - Tests: Integration test that `AgentService` exposes the resolved agent name
    given a config with `agent: "auto"` and mocked availability

### Add `--quiet` flag

- [x] Add a `--quiet` / `-q` CLI flag to suppress informational output
  - Add the flag to the root command options (e.g. via `@effect/cli` `Options`)
  - When `--quiet` is set, skip banner and decision tree output
  - Store the flag in a service or context so downstream renderers can check it
  - Tests: CLI integration test that `--quiet` suppresses all stderr info
    output; test that without `--quiet` the banner and decision tree appear

### Add run info banner to CLI output

- [x] Create a `RunInfo` type capturing environment-derived metadata
  - Fields: `agent` (resolved name), `step` (inferred step like
    plan/build/learn/cleanup/idle), `planFile` (config file path),
    `configSources` (list of loaded config filepaths)
  - Do NOT include git branch or working directory path
  - Define in a new `src/services/RunInfo.ts` or inline in `cli.ts`
  - Tests: Type-level only — ensure the type is used in the banner renderer

- [x] Render the run info banner at the start of each run
  - After `gatherState` and `dispatch` in the root command, print a short banner
    to stderr (so it doesn't interfere with piped stdout)
  - Guard output behind `!quiet` check — skip when `--quiet` is set
  - Format example:
    `[gtd] agent=pi (auto) step=build file=TODO.md configs=.gtdrc.json,~/.config/gtd/.gtdrc.json`
  - Use `Console.error` or `process.stderr.write` so it doesn't pollute stdout
  - Tests: Capture stderr output in CLI integration test; verify banner contains
    agent name, step, and file path; verify suppressed with `--quiet`

### Log decision tree

- [ ] Log the full decision tree to stderr on each invocation
  - After the dispatch/gatherState phase, render a human-readable trace of how
    the step was determined (e.g. "has PR feedback → feedback", "has unchecked
    items → build", "no work → idle")
  - Guard output behind `!quiet` check — skip when `--quiet` is set
  - Print to stderr so it doesn't interfere with piped stdout
  - Format example:
    ```
    [gtd] decision: has PR comments? no → has plan with unchecked items? yes → step=build
    ```
  - Tests: CLI integration test that decision tree appears on stderr; verify it
    reflects the actual step chosen; verify suppressed with `--quiet`

### Expose config sources from resolver

- [ ] Return loaded config filepaths from `GtdConfigService`
  - `mergeConfigs` already receives config results with `filepath` — propagate
    the list of filepaths into the merged config or a sidecar value
  - Option A: Add `readonly configSources: ReadonlyArray<string>` to `GtdConfig`
  - Option B: Return a tuple `[GtdConfig, string[]]` from the layer and store
    sources separately
  - Tests: Unit test `mergeConfigs` returns source paths; integration test that
    `GtdConfigService` exposes which files were loaded

## Learnings

- Always write environment/debug info to stderr so it doesn't break piped output
  or downstream tooling
- Do not include git branch or working directory in the run info banner — keep
  it focused on agent, step, config sources
