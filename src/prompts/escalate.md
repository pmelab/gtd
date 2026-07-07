<%~ include("@header") %>

<%~ include("@context", { context: it.context, fenceFor: it.fenceFor }) %>
The agent was not able to fix all errors on its own. The last error report is
stored in `ERRORS.md` for a human to investigate.

Next steps for the human developer:

1. Investigate and fix errors reported in `ERRORS.md`
2. Delete `ERRORS.md`
3. Continue the process when you are ready

<%~ include(it.tail) %>
