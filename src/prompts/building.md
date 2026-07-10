<%~ include("@header") %>

Build the package described below by orchestrating the execution — you do not
implement the tasks yourself. Spawn **one subagent per task**, all in
**parallel**, each using model `<%= it.model %>`:

- **Context**: the task content only (it is self-contained).
- **Fresh context**: each worker starts cold, with no shared history.
- **TDD discipline** (inline rules for workers):
  - Write ONE test → implement → pass → repeat (vertical slices).
  - **Do NOT** write all tests first then implement (horizontal slicing).
  - Tests verify behavior through public interfaces, not implementation details
    — a good test survives a refactor.

Wait for all workers to complete. **If any worker fails** (crash, timeout, error
— not a test failure): report which tasks failed and ask the user whether to
retry the failed tasks, skip and continue, or abort.

Leave all changes uncommitted. An outside process handles that.
<% if (it.context.packages[0]) { %>
<%~ include("@package", { pkg: it.context.packages[0], fenceFor: it.fenceFor }) %>
<% } %>

<%~ include(it.tail) %>
