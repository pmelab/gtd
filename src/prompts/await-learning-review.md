<%~ include("@header") %>

`.gtd/LEARNINGS.md` holds the distilled learnings from this cycle, drafted by
the agent. This is a human gate; there is nothing for the agent to do.

Tell the user:

- Read `.gtd/LEARNINGS.md`.
- Delete anything not worth keeping, or edit/add anything the draft missed.
- Run `gtd step` — with or without edits, either way proceeds: the agent
  integrates whatever remains into the project's own memory
  (CLAUDE.md/AGENTS.md/docs) next.

There is no reject path — this gate only refines what gets kept, it doesn't
send the cycle back for rework.

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
