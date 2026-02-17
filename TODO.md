# Sandbox Runtime Integration with Dynamic Boundary Escalation

## Action Items

### Research & API Discovery

- [ ] Investigate the `@anthropic-experimental/sandbox-runtime` package API
      surface
  - Clone or inspect https://github.com/anthropic-experimental/sandbox-runtime
  - Document the container/sandbox lifecycle: create → configure → run → destroy
  - Identify how tool permissions and file system access are controlled
  - Map out which sandbox capabilities correspond to gtd's existing agent guards
    (inactivity timeout, forbidden tools)
  - Tests: Create a spike script that boots a sandbox, runs a trivial command,
    and tears it down

### Sandbox Agent Provider

- [ ] Create `src/services/agents/Sandbox.ts` implementing `AgentProvider`
  - Wrap sandbox-runtime SDK to manage sandbox lifecycle within `invoke()`
  - Map `AgentInvocation` fields (prompt, systemPrompt, mode, cwd) to sandbox
    API parameters
  - Emit `AgentEvent` stream by parsing sandbox output (follow pattern from
    `Claude.ts`/`Pi.ts`)
  - Handle sandbox teardown on both success and error paths using Effect's
    resource management (`Effect.acquireRelease` or `Effect.ensuring`)
  - Tests: Unit test with mocked sandbox SDK — verify lifecycle (create → invoke
    → destroy), event parsing, and error teardown

- [ ] Register the sandbox provider in `resolveAgent()` in `Agent.ts`
  - Add `"sandbox"` as a new agent ID option
  - Integrate into the `"auto"` resolution chain (decide priority order relative
    to pi/opencode/claude)
  - Update `isAvailable()` to check for sandbox-runtime SDK presence
  - Tests: Unit test that `resolveAgent("sandbox")` returns the sandbox
    provider; verify auto-resolution includes it when available

### Boundary Escalation Model

- [ ] Define a `BoundaryLevel` type and escalation policy in
      `src/services/SandboxBoundaries.ts`
  - Design tiered permission levels (e.g., `readonly` → `readwrite` → `network`
    → `full`)
  - Each level maps to concrete sandbox capabilities: file system scope, network
    access, allowed tools, allowed shell commands
  - Make the escalation policy configurable via `.gtdrc.json` (e.g.,
    `sandboxBoundaries` field with per-level tool/path allowlists)
  - Tests: Unit test that each boundary level produces the expected sandbox
    capability set; test config parsing with custom boundaries

- [ ] Implement automatic escalation triggers tied to the gtd workflow phases
  - `plan` mode → `readonly` (agent only reads files and writes to TODO.md)
  - `build` mode → `readwrite` (agent can modify source files, run tests)
  - `learn` mode → `readonly` (agent only reads diff and writes to AGENTS.md)
  - Escalation within `build`: start at `readwrite`, escalate to `network` only
    if test command requires it (detect via test failure + network error signal)
  - Tests: Unit test that `mode` → `BoundaryLevel` mapping is correct;
    integration test that a build invocation starts restricted and logs
    escalation events

- [ ] Integrate boundary escalation into `AgentGuards`
  - Extend `AgentGuardsConfig` with an optional `boundaryLevel` field
  - When a sandbox agent is active, forbidden tools list is derived from the
    current boundary level rather than static config
  - On escalation, update the sandbox's live permissions via SDK API (if
    supported) or restart with new config
  - Emit a new `AgentEvent` variant (e.g., `BoundaryEscalated`) so the TUI/logs
    reflect permission changes
  - Tests: Unit test that guard config adapts to boundary level; test that
    forbidden tool detection respects current level, not just static config

### Configuration & Schema

- [ ] Extend `.gtdrc.json` schema and `ConfigResolver.ts` for sandbox settings
  - Add `sandboxEnabled: boolean` (default `false`) — opt-in to sandbox
    execution
  - Add `sandboxBoundaries` object with per-phase overrides (e.g.,
    `{ "plan": "readonly", "build": "readwrite" }`)
  - Add `sandboxEscalationPolicy: "auto" | "manual"` (auto = escalate on failure
    signals, manual = require human approval)
  - Update JSON schema (`ConfigSchema.ts`) and keep `SCHEMA_URL` pointing to the
    GitHub-hosted version
  - Tests: Config parsing tests — valid configs parse correctly, invalid
    boundary levels are rejected, defaults apply when fields are omitted

### Documentation & Examples

- [ ] Update README.md with sandbox runtime section
  - Explain the boundary escalation model and per-phase defaults
  - Add example `.gtdrc.json` with sandbox configuration
  - Document the escalation flow in the mermaid diagram
  - Tests: README test (`readme.test.ts`) still passes; example config validates
    against schema

## Open Questions

- Does `sandbox-runtime` support live permission changes on a running sandbox,
  or must we restart with new config for each escalation?
- Should boundary escalation require explicit human approval (e.g., prompt in
  TUI) or be fully automatic based on workflow phase?
- What is the performance overhead of sandbox boot/teardown per agent invocation
  — should we pool/reuse sandbox instances across build steps?
- How should sandbox mode interact with the existing `agentForbiddenTools`
  config — override, merge, or error if both are set?
- Should the sandbox agent be a wrapper around existing providers (run
  pi/opencode/claude _inside_ the sandbox) or a standalone provider using the
  Anthropic API directly?

## Learnings

- Always use Effect resource management (`acquireRelease` / `ensuring`) for
  sandbox lifecycle to guarantee teardown on all exit paths
- Prefer deriving permissions from workflow phase rather than requiring manual
  per-project configuration — sensible defaults reduce config burden
