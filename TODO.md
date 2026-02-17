# Sandbox Runtime Integration with Dynamic Boundary Escalation

## Action Items

### Research & API Discovery

- [x] Investigate the `@anthropic-experimental/sandbox-runtime` package API
      surface

  - The package is actually `@anthropic-ai/sandbox-runtime` (v0.0.37)
  - Exports: `SandboxManager` (singleton), `SandboxViolationStore`, config
    schemas (`SandboxRuntimeConfigSchema`, `NetworkConfigSchema`,
    `FilesystemConfigSchema`, `IgnoreViolationsConfigSchema`)
  - Lifecycle: `SandboxManager.initialize(config, askCallback?)` →
    `wrapWithSandbox(command)` → `cleanupAfterCommand()` → `reset()`
  - Config structure:
    `{ network: { allowedDomains, deniedDomains, allowUnixSockets, allowLocalBinding, httpProxyPort, socksProxyPort }, filesystem: { denyRead, allowWrite, denyWrite, allowGitConfig }, ignoreViolations?, enableWeakerNestedSandbox?, allowPty?, seccomp? }`
  - Live permission changes: `SandboxManager.updateConfig(newConfig)` allows
    updating capabilities on a running sandbox without restart
  - `wrapWithSandbox(command)` returns a modified command string that runs
    inside the sandbox (uses seatbelt on macOS, bubblewrap on Linux)
  - `SandboxViolationStore` tracks violations in-memory with subscribe/notify
  - `SandboxAskCallback` is called for network requests to unknown hosts
  - Maps to gtd: filesystem config → boundary levels, network config →
    escalation tiers, violation store → event monitoring
  - Platform support: `isSupportedPlatform()`, `checkDependencies()`, macOS
    (seatbelt/sandbox-exec) and Linux (bubblewrap + seccomp)
  - Tests: Spike deferred to implementation phase (sandbox wrapper work package)

- [x] Audit all agent provider tool calls and build per-agent forbidden tool
      blocklists
  - Created `src/services/ForbiddenTools.ts` with `AGENT_TOOL_CATALOG` and
    `FORBIDDEN_TOOLS` constants keyed by `AgentProviderType`
  - Pi tools (from pi-coding-agent README): read, bash, edit, write, grep, find,
    ls — no built-in interactive tools
  - OpenCode tools (from opencode source registry.ts): bash, read, glob, grep,
    edit, write, task, webfetch, todowrite, todoread, websearch, codesearch,
    skill, apply_patch, lsp, batch, plan_enter, plan_exit, question, multiedit —
    "question" is interactive
  - Claude tools (from @anthropic-ai/claude-agent-sdk sdk-tools.d.ts): Agent,
    Bash, TaskOutput, ExitPlanMode, FileEdit, FileRead, FileWrite, Glob, Grep,
    TaskStop, ListMcpResources, Mcp, NotebookEdit, ReadMcpResource, TodoWrite,
    WebFetch, WebSearch, AskUserQuestion, Config — "AskUserQuestion" is
    interactive
  - Forbidden tools: pi=[], opencode=["question"], claude=["AskUserQuestion"]
  - Tests: 15 tests in `ForbiddenTools.test.ts` — unit tests verify blocklist
    contents, catalog completeness, forbidden-is-subset-of-catalog invariant; 6
    snapshot tests catch upstream tool additions

### Internalize `agentForbiddenTools` (Remove from Config)

- [x] Replace `agentForbiddenTools` config field with internal per-agent
      blocklists

  - Create a `FORBIDDEN_TOOLS` constant map in `src/services/AgentGuards.ts`
    keyed by agent provider type (e.g.,
    `{ pi: [...], opencode: [...], claude: ["AskUserQuestion", ...] }`)
  - Update `GuardConfig` to accept agent provider type instead of
    `forbiddenTools` array — the guard resolves the blocklist internally
  - Update `Agent.ts` `resolveAgent()` to pass the agent type to guards instead
    of reading `config.agentForbiddenTools`
  - Tests: Unit test that guards reject interactive tools for each agent type
    using the internal blocklist; test that no config field is needed

- [x] Remove `agentForbiddenTools` from config schema and resolver
  - Remove `agentForbiddenTools` from `GtdConfigSchema` in `ConfigSchema.ts`
  - Remove `agentForbiddenTools` from defaults in `ConfigResolver.ts`
  - Remove `agentForbiddenTools` from `GtdConfig` type in `Config.ts`
  - Remove from `test-helpers.ts` default test config
  - Update all tests in `ConfigSchema.test.ts`, `ConfigResolver.test.ts`,
    `Config.test.ts`, and `Agent.test.ts` to remove references to
    `agentForbiddenTools`
  - Update example `.gtdrc.json` files to remove the field
  - Tests: Verify config parsing still works without the field; verify old
    configs with the field are accepted gracefully (ignored, not rejected) for
    backwards compatibility

### Sandbox Agent Provider (Wrapper Architecture)

- [x] Create `src/services/agents/Sandbox.ts` as a wrapper around existing
      providers

  - Wrap an inner `AgentProvider` (pi, opencode, or claude) — the sandbox
    manages the execution environment while the inner provider drives the agent
  - Accept the inner provider via constructor/config so any existing provider
    can run inside the sandbox
  - Manage sandbox lifecycle within `invoke()`: boot sandbox → delegate to inner
    provider running inside sandbox → teardown
  - Map `AgentInvocation` fields (prompt, systemPrompt, mode, cwd) through to
    the inner provider
  - Emit `AgentEvent` stream by composing inner provider events with
    sandbox-specific events (boundary changes, sandbox lifecycle)
  - Handle sandbox teardown on both success and error paths using Effect's
    resource management (`Effect.acquireRelease` or `Effect.ensuring`)
  - Tests: Unit test with mocked sandbox SDK and mocked inner provider — verify
    lifecycle (create → delegate → destroy), event composition, and error
    teardown

- [x] Register the sandbox provider in `resolveAgent()` in `Agent.ts`
  - When `sandboxEnabled` is true, wrap the resolved provider
    (pi/opencode/claude) in the `Sandbox` provider rather than adding a separate
    agent ID
  - Update `isAvailable()` to check for sandbox-runtime SDK presence
  - Tests: Unit test that `resolveAgent()` with sandbox enabled wraps the inner
    provider; verify the unwrapped provider is used when sandbox is disabled

### Boundary Escalation Model

- [x] Define a `BoundaryLevel` type and escalation policy in
      `src/services/SandboxBoundaries.ts`

  - Design tiered permission levels (e.g., `readonly` → `readwrite` → `network`
    → `full`)
  - Each level maps to concrete sandbox capabilities: file system scope, network
    access, allowed shell commands
  - Make the escalation policy configurable via `.gtdrc.json` (e.g.,
    `sandboxBoundaries` field with per-level path/network allowlists)
  - Tests: Unit test that each boundary level produces the expected sandbox
    capability set; test config parsing with custom boundaries

- [x] Implement automatic escalation triggers tied to the gtd workflow phases

  - `plan` mode → `readonly` (agent only reads files and writes to TODO.md)
  - `build` mode → `readwrite` (agent can modify source files, run tests)
  - `learn` mode → `readonly` (agent only reads diff and writes to AGENTS.md)
  - Escalation within `build`: start at `readwrite`, escalate to `network` only
    if test command requires it (detect via test failure + network error signal)
  - Apply live permission changes via the sandbox SDK when escalating (no
    restart needed)
  - Tests: Unit test that `mode` → `BoundaryLevel` mapping is correct;
    integration test that a build invocation starts restricted and logs
    escalation events

- [x] Integrate boundary escalation events into `AgentGuards`
  - Forbidden tools (internal blocklist) handles tool calls that cannot work in
    a non-interactive environment (e.g., user input prompts) and causes
    immediate errors regardless of sandbox state
  - Sandbox boundaries control a separate concern: isolation permissions (file
    system scope, network access, shell commands) enforced by the sandbox
    runtime
  - Both mechanisms apply simultaneously — a tool can be allowed by the sandbox
    but still forbidden by the internal blocklist if it requires interactivity
  - On escalation, update the sandbox's live permissions via SDK API
  - Emit a new `AgentEvent` variant (e.g., `BoundaryEscalated`) so the TUI/logs
    reflect permission changes
  - Tests: Unit test that internal forbidden tool blocklist still rejects
    interactive tools even when sandbox grants broad permissions; test that
    sandbox boundary escalation emits the correct event; test that both guard
    layers are evaluated independently

### Strict Default Permissions

- [x] Default filesystem sandbox to current working directory only

  - Set `allowWrite` to `[cwd]` and deny reads outside `cwd` by default so
    agents can only read and write within the project directory
  - Derive `cwd` from `AgentInvocation.cwd` when constructing the sandbox config
  - Allow overrides via `sandboxBoundaries.filesystem.allowRead` and
    `sandboxBoundaries.filesystem.allowWrite` arrays in `.gtdrc.json` for
    projects that need access to paths outside cwd (e.g., shared libraries,
    monorepo roots)
  - Tests: Unit test that default sandbox config restricts filesystem to cwd;
    test that config overrides extend the allowed paths; test that paths outside
    cwd are denied by default

- [x] Default network sandbox to agent-essential domains only
  - Build a per-agent-provider allowlist of domains required for the agent to
    function (e.g., API endpoints for Claude, OpenCode, Pi)
  - Set `network.allowedDomains` to only these essential domains by default;
    deny all other outbound network requests
  - Allow users to extend the allowlist via
    `sandboxBoundaries.network.allowedDomains` in `.gtdrc.json` for projects
    that need additional network access (e.g., package registries, internal
    APIs)
  - Tests: Unit test that default network config only allows agent-essential
    domains; test that user config extends (not replaces) the essential
    allowlist; test that requests to non-allowed domains are denied

### Fail-Stop Escalation (Replace Prompt-Based Approval)

- [x] Replace interactive escalation prompts with fail-stop behavior

  - When a sandbox violation occurs (filesystem access outside cwd, network
    request to non-allowed domain), stop the agent process immediately with a
    clear error message describing the violation
  - The error message must include: what was attempted, what permission is
    missing, and how to grant it (either adjust `sandboxBoundaries` in
    `.gtdrc.json` or adjust the task requirements)
  - Remove the `SandboxAskCallback` usage — never prompt the user during agent
    execution
  - Tests: Unit test that a filesystem violation stops the process with an
    actionable error message; test that a network violation stops with the
    correct domain and config hint; test that no interactive prompt is ever
    triggered

- [x] Remove `sandboxEscalationPolicy` and `sandboxApprovedEscalations` from
      config

  - Remove `sandboxEscalationPolicy` field (no longer needed — policy is always
    fail-stop)
  - Remove `sandboxApprovedEscalations` array (no longer needed — users grant
    permissions statically in config)
  - Update `ConfigSchema.ts`, `ConfigResolver.ts`, and `Config.ts` to remove
    these fields
  - Keep backwards compatibility by ignoring these fields if present in existing
    configs
  - Tests: Config parsing tests — verify old configs with these fields still
    parse without error; verify new configs without these fields parse correctly

- [x] Update `SandboxBoundaries.ts` to remove dynamic escalation logic
  - Remove the escalation state machine (no more runtime transitions between
    boundary levels)
  - Permissions are fully determined at sandbox boot time from the workflow
    phase + user config overrides
  - The `BoundaryLevel` type still maps phases to capabilities, but transitions
    are no longer triggered at runtime — if the agent needs more permissions,
    the user must update config and re-run
  - Tests: Unit test that boundary level is fixed at boot and does not change
    during execution; test that violation triggers process stop, not escalation

### Configuration & Schema

- [x] Extend `.gtdrc.json` schema and `ConfigResolver.ts` for sandbox settings

  - Add `sandboxEnabled: boolean` (default `false`) — opt-in to sandbox
    execution
  - Add `sandboxBoundaries` object with per-phase overrides (e.g.,
    `{ "plan": "readonly", "build": "readwrite" }`)
  - Add `sandboxEscalationPolicy: "auto" | "prompt"` (`auto` = use saved
    approvals or escalate on failure signals, `prompt` = always require human
    approval)
  - Add `sandboxApprovedEscalations` array to persist user-approved escalation
    rules at project or user config level
  - Update JSON schema (`ConfigSchema.ts`) and keep `SCHEMA_URL` pointing to the
    GitHub-hosted version
  - Tests: Config parsing tests — valid configs parse correctly, invalid
    boundary levels are rejected, defaults apply when fields are omitted,
    approved escalations merge correctly across config levels

- [x] Update config schema for fail-stop model and strict defaults
  - Replace `sandboxBoundaries` with a more explicit structure:
    `{ filesystem: { allowRead?: string[], allowWrite?: string[] }, network: { allowedDomains?: string[] } }`
    where all arrays default to cwd-only / agent-essential-only
  - Remove `sandboxEscalationPolicy` and `sandboxApprovedEscalations` from
    schema (see fail-stop work package)
  - Update example `.gtdrc.json` to show how to extend default permissions
    (e.g., adding a package registry domain, allowing writes to a shared
    directory)
  - Update JSON schema and `SCHEMA_URL`
  - Tests: Config parsing tests — defaults produce cwd-only + agent-essential
    network; user overrides merge correctly; example config validates against
    schema

### Documentation & Examples

- [x] Update README.md with sandbox runtime section

  - Explain the wrapper architecture (sandbox wraps existing providers)
  - Explain the boundary escalation model and per-phase defaults
  - Document the approval flow and how to persist escalation approvals
  - Clarify that forbidden tool blocklists (interactivity guard) and sandbox
    boundaries (isolation guard) are orthogonal — both apply independently
  - Note that forbidden tool blocklists are internal and not user-configurable —
    they are derived from each agent provider's tool catalog
  - Add example `.gtdrc.json` with sandbox configuration including approved
    escalations
  - Document the escalation flow in the mermaid diagram
  - Tests: README test (`readme.test.ts`) still passes; example config validates
    against schema

- [x] Update documentation for fail-stop model and strict defaults
  - Rewrite the sandbox section to explain: strict defaults (cwd-only
    filesystem, agent-essential-only network), fail-stop on violation (no
    prompts), and how to extend permissions via config
  - Add examples showing common permission extensions: adding npm registry
    access, allowing reads from a parent monorepo directory, allowing writes to
    a shared output directory
  - Remove all references to interactive approval prompts, escalation policies,
    and approved escalations
  - Update the mermaid diagram to show the fail-stop flow: violation → error
    message → user adjusts config → re-run
  - Tests: README test (`readme.test.ts`) still passes; example configs validate
    against schema

### E2E Tests for Boundary Escalation via Config Adjustment

- [ ] E2E test: network boundary fail-stop and config-driven escalation

  - Set up a sandbox-enabled gtd run that attempts to fetch data from an
    untrusted URL (not in the default `allowedDomains`)
  - Verify the agent process stops with a fail-stop error identifying the
    blocked domain and suggesting the config change
  - Programmatically update the local `.gtdrc.json` to add the blocked domain to
    `sandboxBoundaries.network.allowedDomains`
  - Re-run gtd with the updated config and verify the fetch succeeds without
    violation
  - Tests: Single e2e test covering the full cycle — run → fail → adjust config
    → re-run → success

- [ ] E2E test: filesystem boundary fail-stop and config-driven escalation
  - Set up a sandbox-enabled gtd run where the agent attempts to write a file to
    a temporary directory outside cwd (e.g., `/tmp/gtd-test-output`)
  - Verify the agent process stops with a fail-stop error identifying the denied
    path and suggesting the config change
  - Programmatically update the local `.gtdrc.json` to add
    `/tmp/gtd-test-output` to `sandboxBoundaries.filesystem.allowWrite`
  - Re-run gtd with the updated config and verify the file write succeeds
  - Repeat the same pattern for reading a file from `/tmp` — first verify read
    is denied, then add to `sandboxBoundaries.filesystem.allowRead`, then verify
    read succeeds
  - Tests: Single e2e test covering write escalation (run → fail → config →
    re-run → success) and a second e2e test covering read escalation with the
    same pattern

## Learnings

- Always use Effect resource management (`acquireRelease` / `ensuring`) for
  sandbox lifecycle to guarantee teardown on all exit paths
- Prefer deriving permissions from workflow phase rather than requiring manual
  per-project configuration — sensible defaults reduce config burden
- `agentForbiddenTools` and sandbox boundaries are orthogonal concerns —
  forbidden tools guard against tool calls that require interactivity (immediate
  error in non-interactive mode), while sandbox boundaries guard isolation
  permissions (file system, network). Never merge or override one with the
  other; evaluate both independently
- Sandbox providers should wrap existing agent providers rather than
  reimplementing the agent protocol — keeps sandbox concerns (permissions,
  isolation) separate from agent concerns (prompting, tool use)
- Prefer internal, hardcoded blocklists over user-facing config for safety
  invariants like forbidden tools — users should not be able to accidentally
  unblock interactive tools in non-interactive mode; derive blocklists from each
  agent provider's actual tool catalog
- When removing a config field, keep backwards compatibility by ignoring (not
  rejecting) the old field in parsing so existing config files don't break
- Default to least privilege: restrict filesystem to cwd and network to
  agent-essential domains only — users explicitly opt in to broader access via
  config rather than opting out of broad defaults
- Prefer fail-stop over interactive prompts in automated pipelines — stopping
  with an actionable error message is safer and more predictable than prompting
  mid-execution; users adjust permissions in config and re-run
- E2E tests for fail-stop boundaries should exercise the full user workflow: run
  → violation → config adjustment → re-run → success — this validates both the
  error messaging and the config-driven escalation path
