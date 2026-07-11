<%~ include("@header") %>

The agent was not able to fix all errors on its own. The last error report is
stored in `.gtd/ERRORS.md` for a human to investigate.

Next steps for the human developer:

1. Investigate and fix errors reported in `.gtd/ERRORS.md`
2. Delete `.gtd/ERRORS.md`
3. Run `gtd step` when you are ready to continue

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
