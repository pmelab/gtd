<%~ include("@header") %>

`.gtd/TODO.md` holds the plan under development, with open questions under a
`## Open Questions` section — each `### <question>` carrying a suggested
default.

This is a human gate; there is nothing for the agent to do.

Tell the user:

- To answer a question, edit its `### <question>` entry under `## Open
  Questions` in place — replace the `Suggested default: ...` line with
  `Answer: ...` (or annotate it further), then run `gtd step`.
- To accept **all** suggested defaults as-is, run `gtd step` with **no
  edits** — this converges the plan and moves on to technical architecting.

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
