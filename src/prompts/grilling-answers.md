<%~ include("@header") %>

`.gtd/TODO.md` holds the plan under development, with open questions written near
the top — each one carrying a suggested default.

This is a human gate; there is nothing for the agent to do.

Tell the user:

- To answer a question, edit `.gtd/TODO.md` in place (replace the question's text
  with your answer, or annotate it), then run `gtd step`.
- To accept **all** suggested defaults as-is, run `gtd step` with **no
  edits** — this converges the plan and moves on to technical architecting.

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
