## Tech stack

CLI application distributed as a bun executable, written with effect.

Relevant base documentation:

- Bun: https://bun.com/llm.txt
- Effect: https://effect.website/llms.txt

It automates AI agent execution and git operations:

- Git: uses the users local git cli, respecting all configuration.
- OpenCode: uses the official opencode sdk (https://opencode.ai/docs/sdk/),
  respects standard project and user configuration
- Claude code: uses the official agent sdk
  (https://platform.claude.com/docs/en/agent-sdk/overview.md), respects all
  project and user configuration

## Blueprint Workflow

- Cleanup commits (e.g., TODO removals) are trivial — use a fixed message like
  "chore: remove TODO", no need for LLM-generated summaries
- When chaining commit-feedback → plan, the plan step should read the last
  commit (`git diff HEAD~1`) rather than the working tree diff (which is empty
  after the commit)

## Guidelines

- use the effect library and it's ecosystem as much as possible
- strict typing everywhere
- use test-driven development:
  - create a test case first
  - verify it fails
  - implementation
  - verify it passes
