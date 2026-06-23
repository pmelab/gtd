docs(config): document .gtdrc, add e2e coverage, rebuild bundle

Document the new .gtdrc config system in README.md and SKILL.md (filenames,
schema, cwd-to-home cascade with the shared-worktree-parent use case,
innermost-wins precedence, overridable testCommand, built-in Opus/Sonnet
defaults) and remove the obsolete AGENTS.md model-preferences prose. Update the
test-command discovery prose in the prompts to note the .gtdrc testCommand takes
precedence. Add cucumber scenarios (config.feature) proving the cascade, the
merge precedence, a custom testCommand reaching the runner, per-state and tier
model names landing in the right prompt sections, a per-state override beating
its tier, and fix-tests carrying no injected model. Rebuild scripts/gtd.js so
the e2e suite runs the current code with cosmiconfig bundled cleanly.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
