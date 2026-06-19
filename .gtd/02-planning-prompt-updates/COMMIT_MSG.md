docs(prompts): add simple-task instructions to planning prompts

Instruct planning-model subagent to evaluate task complexity and append
`<!-- simple -->` marker when:
- All open questions are resolved
- Task scope is small (single-file, no architectural decisions)

This enables the execute-simple branch to be triggered automatically
when the planning model determines decomposition is overkill.
