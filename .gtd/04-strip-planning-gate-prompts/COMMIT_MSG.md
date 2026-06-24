docs(gtd): drop test-gate blocks from non-execute prompts

The test gate is machine-modeled and fires only before `execute`, so the
planning steps and `human-review` no longer run the suite. Remove the now-
misleading "Test gate (run first)" blocks from new-todo, modified-todo,
verified, and human-review prompts. The red-branch prompts (fix-tests, escalate)
keep their test-gate wording. Content-only; vitest stays green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
