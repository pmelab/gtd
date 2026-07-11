<%~ include("@header") %>

Build the package described below by orchestrating the execution — you do not
implement the tasks yourself. Spawn **one subagent per task**, all in
**parallel**, each using model `<%= it.model %>`:

- **Context**: the task content only (it is self-contained).
- **Fresh context**: each worker starts cold, with no shared history.
- **Hands off `.gtd/`** (inline rule for workers): never create, edit, or
  delete anything under `.gtd/` — it is workflow state owned by the machine.
  If the task spec mentions a `.gtd/` file, skip that part.
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

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
