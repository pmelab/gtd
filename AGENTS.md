## Tech stack

CLI application distributed as a bun executable, written with effect.

Relevant base documentation:

- Bun: https://bun.com/llm.txt
- Effect: https://effect.website/llms.txt

It automates AI agent execution and git operations:

- Git: uses the users local git cli, respecting all configuration.
<!-- TODO: information on agents is not up-to-date -->
- OpenCode: uses the official opencode sdk (https://opencode.ai/docs/sdk/),
  respects standard project and user configuration
- Claude code: uses the official agent sdk
  (https://platform.claude.com/docs/en/agent-sdk/overview.md), respects all
  project and user configuration

## Guidelines

- use the effect library and it's ecosystem as much as possible
- strict typing everywhere
- example config files must include a `$schema` reference pointing to the
  GitHub-hosted JSON schema (`SCHEMA_URL` in `ConfigResolver.ts`) so users get
  editor validation out of the box
- use test-driven development:
  - create a test case first
  - verify it fails
  - implementation
  - verify it passes
- order CI steps from fastest/cheapest to slowest/most expensive so failures
  surface early and save runner time — prefer: typecheck → lint → format → unit
  → e2e
- when removing or renaming a config field, keep backwards compatibility by
  ignoring (not rejecting) the old field name in parsing so existing config
  files don't break
- prefer fail-stop over interactive prompts in automated pipelines — stopping
  with an actionable error message is safer and more predictable than prompting
  mid-execution; users adjust permissions in config and re-run
- when changing a default value, update all three layers: the defaults object,
  any hardcoded fallbacks in function signatures, and all test assertions that
  reference the old default

## Architecture

### Resource Management

- always use Effect resource management (`acquireRelease` / `ensuring`) for
  sandbox lifecycle to guarantee teardown on all exit paths

### Sandbox & Permissions

- sandbox providers should wrap existing agent providers rather than
  reimplementing the agent protocol — keeps sandbox concerns (permissions,
  isolation) separate from agent concerns (prompting, tool use)
- `agentForbiddenTools` and sandbox boundaries are orthogonal concerns —
  forbidden tools guard against tool calls that require interactivity (immediate
  error in non-interactive mode), while sandbox boundaries guard isolation
  permissions (file system, network). Never merge or override one with the
  other; evaluate both independently
- prefer internal, hardcoded blocklists over user-facing config for safety
  invariants like forbidden tools — users should not be able to accidentally
  unblock interactive tools in non-interactive mode; derive blocklists from each
  agent provider's actual tool catalog
- default to least privilege: restrict filesystem to cwd and network to
  agent-essential domains only — users explicitly opt in to broader access via
  config rather than opting out of broad defaults
- prefer secure-by-default settings — sandbox should be enabled by default
  following least-privilege principles, with users explicitly opting out rather
  than opting in

### Commit Prefixes

- When adding new commit prefixes, update all three layers: `CommitPrefix.ts`
  (definition + parsing), `InferStep.ts` (next-step logic), and
  `DecisionTree.ts` (display labels)
- Prefer hardcoded priority orders for internal classification logic over
  user-configurable options — the 🌱 > 💬 > 🤦 > 👷 prefix priority is a domain
  invariant, not a user preference

### Agent Providers

- agent providers should accept optional parameters and only pass CLI flags when
  values are explicitly set — never pass empty strings or defaults that override
  the agent's own configuration

### Configuration Design

- prefer deriving permissions from workflow phase rather than requiring manual
  per-project configuration — sensible defaults reduce config burden
- prefer per-mode defaults over a single fallback field — let each agent use its
  own default model when no override is configured, rather than forcing a
  universal fallback

## Testing

- E2E tests should use the same test harness as existing integration tests
  (bats + the actual built binary) rather than vitest with mocked internals —
  true e2e tests must exercise the real CLI entry point to catch integration
  issues
- E2E tests for fail-stop boundaries should exercise the full user workflow: run
  → violation → config adjustment → re-run → success — this validates both the
  error messaging and the config-driven escalation path
