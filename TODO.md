# Sandbox Runtime Integration with Dynamic Boundary Escalation

## Action Items

### Research & API Discovery

- [ ] Investigate the `@anthropic-experimental/sandbox-runtime` package API
      surface
  - Clone or inspect https://github.com/anthropic-experimental/sandbox-runtime
  - Document the container/sandbox lifecycle: create → configure → run → destroy
  - Identify how tool permissions and file system access are controlled
  - Confirm live permission change API (updating capabilities on a running
    sandbox without restart)
  - Map out which sandbox capabilities correspond to gtd's existing agent guards
    (inactivity timeout, forbidden tools)
  - Tests: Create a spike script that boots a sandbox, runs a trivial command,
    changes permissions live, and tears it down

### Sandbox Agent Provider (Wrapper Architecture)

- [ ] Create `src/services/agents/Sandbox.ts` as a wrapper around existing
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

- [ ] Register the sandbox provider in `resolveAgent()` in `Agent.ts`
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
  - Apply live permission changes via the sandbox SDK when escalating (no
    restart needed)
  - Tests: Unit test that `mode` → `BoundaryLevel` mapping is correct;
    integration test that a build invocation starts restricted and logs
    escalation events

- [ ] Integrate boundary escalation into `AgentGuards`
  - When sandbox mode is active, the sandbox boundary level overrides
    `agentForbiddenTools` — sandbox permissions are the single source of truth
    > i think agentForbiddenTools are something completely different. those are
    > tool calls the agent could emit that can't be handled in a non-interactive
    > environment and therefore cause immediate error. this is orthogonal to the
    > sandbox. correct me if i'm wrong.
  - On escalation, update the sandbox's live permissions via SDK API
  - Emit a new `AgentEvent` variant (e.g., `BoundaryEscalated`) so the TUI/logs
    reflect permission changes
  - Tests: Unit test that sandbox boundary level overrides static
    `agentForbiddenTools`; test that forbidden tool detection respects current
    boundary level

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
  - Document that sandbox boundaries override `agentForbiddenTools` when active
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
  - Document that sandbox boundaries override `agentForbiddenTools`
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
- When two config mechanisms control the same concern (e.g.,
  `agentForbiddenTools` vs sandbox boundaries), pick one as authoritative and
  override rather than merging — avoids confusing interaction semantics
- Sandbox providers should wrap existing agent providers rather than
  reimplementing the agent protocol — keeps sandbox concerns (permissions,
  isolation) separate from agent concerns (prompting, tool use)
- Approval persistence should support multiple config levels (project, user) so
  teams can share common escalation policies while individuals can customize
