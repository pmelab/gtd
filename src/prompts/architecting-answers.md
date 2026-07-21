<%~ include("@header") %>

`.gtd/ARCHITECTURE.md` holds the technical plan under development, with open
questions under a `## Open Questions` section — each `### <question>`
carrying a suggested default.

This is a human gate; there is nothing for the agent to do.

Tell the user:

- To answer a question, edit its `### <question>` entry under `## Open
  Questions` in place — replace the `Suggested default: ...` line with
  `Answer: ...` (or annotate it further), then run `gtd step human`.
- To accept **all** suggested defaults as-is, run `gtd step human` with **no
  edits** — this converges the architecture and moves on to decomposition.

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
