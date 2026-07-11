<%~ include("@header") %>

The idle health check failed — the repository's test suite is red outside any
work cycle. Spawn a **fix subagent** using model `<%= it.model %>` to repair
it:

1. **Work through the failure output below** — make the failing test command
   pass again.
2. **Make the fix in place** — keep the change focused; do not refactor
   unrelated code.
3. **If the failure does not reproduce** (or nothing needs changing), change
   nothing and simply finish your turn — the machine re-runs the health check
   either way.
4. **Never create or edit any file under `.gtd/`** — in particular, do NOT
   write `.gtd/FEEDBACK.md`. The machine removes `.gtd/HEALTH.md` itself when
   your turn is captured.
5. **Leave every change uncommitted and finish your turn** — do **not** commit
   or stage.
<% if (it.context.feedbackContent.trim()) { %>
<%~ include("@feedback", { content: it.context.feedbackContent, fenceFor: it.fenceFor }) %>
<% } %>

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
