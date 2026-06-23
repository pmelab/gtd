feat(config): add ConfigService with hierarchical cwd-to-home config walk

Introduce src/Config.ts, an Effect ConfigService (Context.Tag + static Live)
that loads gtd config via cosmiconfig, walking from cwd up to the home dir (or
filesystem root when cwd is outside home), merging every level found with the
innermost winning. Decodes the merged object with effect/Schema: optional
testCommand (defaults to "npm run test") and an optional models block with
planning/execution tiers plus per-state overrides for the 5 subagent-spawning
states (unknown keys, including fix-tests, are rejected). Exposes testCommand
and resolveModel(state) with state -> tier -> built-in (Opus/Sonnet) resolution.

Adds cosmiconfig to dependencies (YAML backed by the existing yaml dep, no
js/cjs loaders) and unit tests covering walk, merge precedence, defaults, model
resolution, and schema rejection. Not yet consumed; TestRunner and buildPrompt
wire it in subsequent packages.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
