docs(gtd): document named-package execute prompt and dropped cleanup round-trip

Update README and SKILL.md: the execute prompt now names the single next package
and inlines its task-file contents (the agent no longer browses `.gtd/` or picks
the lowest-numbered), and execute deletes the empty `.gtd/` on the last package
so the next run goes straight to human-review. Clarify the `cleanup` state is
retained only as a safety net for a stray empty `.gtd/`. Mermaid diagram updated
to match.

Post-merge integration steps (orchestrator):
- docs-only; no tests or build required (cucumber suite asserts behavior, not
  README prose)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
