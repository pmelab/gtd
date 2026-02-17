# Sandbox Runtime Integration with Dynamic Boundary Escalation

## Action Items

### Research & API Discovery

- [x] Investigate the `@anthropic-experimental/sandbox-runtime` package API
      surface

  - The package is actually `@anthropic-ai/sandbox-runtime` (v0.0.37)
  - Exports: `SandboxManager` (singleton), `SandboxViolationStore`,
    config schemas (`SandboxRuntimeConfigSchema`, `NetworkConfigSchema`,
    `FilesystemConfigSchema`, `IgnoreViolationsConfigSchema`)
  - Lifecycle: `SandboxManager.initialize(config, askCallback?)` →
    `wrapWithSandbox(command)` → `cleanupAfterCommand()` → `reset()`
  - Config structure: `{ network: { allowedDomains, deniedDomains,
    allowUnixSockets, allowLocalBinding, httpProxyPort, socksProxyPort },
    filesystem: { denyRead, allowWrite, denyWrite, allowGitConfig },
    ignoreViolations?, enableWeakerNestedSandbox?, allowPty?, seccomp? }`
  - Live permission changes: `SandboxManager.updateConfig(newConfig)` allows
    updating capabilities on a running sandbox without restart
  - `wrapWithSandbox(command)` returns a modified command string that runs
    inside the sandbox (uses seatbelt on macOS, bubblewrap on Linux)
  - `SandboxViolationStore` tracks violations in-memory with subscribe/notify
  - `SandboxAskCallback` is called for network requests to unknown hosts
  - Maps to gtd: filesystem config → boundary levels, network config →
    escalation tiers, violation store → event monitoring
  - Platform support: `isSupportedPlatform()`, `checkDependencies()`,
    macOS (seatbelt/sandbox-exec) and Linux (bubblewrap + seccomp)
  - Tests: Spike deferred to implementation phase (sandbox wrapper work package)

- [x] Audit all agent provider tool calls and build per-agent forbidden tool
      blocklists
  - Created `src/services/ForbiddenTools.ts` with `AGENT_TOOL_CATALOG` and
    `FORBIDDEN_TOOLS` constants keyed by `AgentProviderType`
  - Pi tools (from pi-coding-agent README): read, bash, edit, write, grep,
    find, ls — no built-in interactive tools
  - OpenCode tools (from opencode source registry.ts): bash, read, glob, grep,
    edit, write, task, webfetch, todowrite, todoread, websearch, codesearch,
    skill, apply_patch, lsp, batch, plan_enter, plan_exit, question, multiedit
    — "question" is interactive
  - Claude tools (from @anthropic-ai/claude-agent-sdk sdk-tools.d.ts):
    Agent, Bash, TaskOutput, ExitPlanMode, FileEdit, FileRead, FileWrite,
    Glob, Grep, TaskStop, ListMcpResources, Mcp, NotebookEdit,
    ReadMcpResource, TodoWrite, WebFetch, WebSearch, AskUserQuestion, Config
    — "AskUserQuestion" is interactive
  - Forbidden tools: pi=[], opencode=["question"], claude=["AskUserQuestion"]
  - Tests: 15 tests in `ForbiddenTools.test.ts` — unit tests verify blocklist
    contents, catalog completeness, forbidden-is-subset-of-catalog invariant;
    6 snapshot tests catch upstream tool additions

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

- [ ] Define a `BoundaryLevel` type and escalation policy in
      `src/services/SandboxBoundaries.ts`

  - Design tiered permission levels (e.g., `readonly` → `readwrite` → `network`
    → `full`)
  - Each level maps to concrete sandbox capabilities: file system scope, network
    access, allowed shell commands
  - Make the escalation policy configurable via `.gtdrc.json` (e.g.,
    `sandboxBoundaries` field with per-level path/network allowlists)
  - Tests: Unit test that each boundary level produces the expected sandbox
    capability set; test config parsing with custom boundaries

- [ ] Implement automatic escalation triggers tied to the gtd workflow phases

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

- [ ] Integrate boundary escalation events into `AgentGuards`
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

### Escalation Approval & Persistence

- [ ] Implement human approval flow for boundary escalation
  - On escalation trigger, prompt the user for approval (e.g., TUI dialog or CLI
    confirmation)
  - Offer three options: approve once, approve and save to project config, or
    approve and save to user config
  - "Save to project config" writes the escalation rule into the project-level
    `.gtdrc.json` so it auto-approves next time
  - "Save to user config" writes to the user-level config for cross-project
    persistence
  - When a saved approval exists at any config level, skip the prompt and
    escalate automatically
  - Tests: Unit test each approval path (once, project-persist, user-persist);
    verify saved approvals bypass the prompt on subsequent runs; verify config
    merging respects level priority

### Configuration & Schema

- [ ] Extend `.gtdrc.json` schema and `ConfigResolver.ts` for sandbox settings
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

### Documentation & Examples

- [ ] Update README.md with sandbox runtime section
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
- Approval persistence should support multiple config levels (project, user) so
  teams can share common escalation policies while individuals can customize
- Prefer internal, hardcoded blocklists over user-facing config for safety
  invariants like forbidden tools — users should not be able to accidentally
  unblock interactive tools in non-interactive mode; derive blocklists from each
  agent provider's actual tool catalog
- When removing a config field, keep backwards compatibility by ignoring (not
  rejecting) the old field in parsing so existing config files don't break
