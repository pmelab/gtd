<%~ include("@header") %>

Spawn a **fix subagent** using model `<%= it.model %>` to apply fixes for the feedback
below:

1. **Work through the Feedback to address section below** — address every item
   it lists. For test output, make the failing tests pass; for review findings,
   satisfy each finding against the package's task specs.
2. **Make the fix in place** — change the code to resolve the feedback. Keep the
   change focused; do not refactor unrelated code.
3. **Or dispute the feedback** — if a finding is wrong, empty or delete
   `FEEDBACK.md` instead of fixing it. The machine re-tests either way.
4. **Leave every change uncommitted and finish your turn** — do **not** commit
   or stage.
<% if (it.context.feedbackContent.trim()) { %>
<%~ include("@feedback", { content: it.context.feedbackContent, fenceFor: it.fenceFor }) %>
<% } %>

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
