feat(config): inject resolved model names into subagent-spawning prompts

buildPrompt now substitutes a concrete per-state model name into the 5 prompts
that spawn subagents (new-todo, modified-todo, decompose, execute,
execute-simple), replacing the "check AGENTS.md for model preferences" prose.
The resolver comes from ConfigService.resolveModel (threaded through main.ts)
and falls back to built-in tier defaults (Opus for planning, Sonnet for
execution) when unset. header.md drops its two-tier AGENTS.md prose; fix-tests
spawns no subagent and carries no model directive. Prompt tests assert the
default and injected names, per-state overrides beating their tier, and that the
AGENTS.md model prose and placeholder no longer leak.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
