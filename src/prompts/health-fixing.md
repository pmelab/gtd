<%~ include("@header") %>

The repository's health gate is red outside any work cycle — either the idle
health check failed, or a human hand-wrote `.gtd/HEALTH.md` describing errors
to fix. Spawn a **fix subagent** using model `<%= it.model %>` to repair it:

1. **Work through the report below** — fix the described errors and make the
   test command pass.
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
