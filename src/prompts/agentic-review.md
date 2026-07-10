<%~ include("@header") %>

Spawn a **reviewing subagent** using model `<%= it.model %>`. The package's task spec
files and its cumulative diff are found below. The subagent must:

1. **Read the task spec files** — they define the acceptance criteria. Every
   requirement must be checked.
2. **Read the package diff** — examine every hunk to determine whether the
   implementation satisfies the spec.
3. **Always write `FEEDBACK.md`** in the repo root:
   - **Fully satisfies the spec** → write an **empty** `FEEDBACK.md` (zero bytes
     or whitespace only). This empty file is the **approval** signal.
   - **Does not fully satisfy** → write concrete, actionable findings anchored
     to specific file and symbol names, grouped under short headings, so the fix
     agent can act without re-reading the diff.
4. **Do not edit source files and do not commit** — the reviewer only writes
   `FEEDBACK.md`, left uncommitted.
<% if (it.context.packages[0]) { %>
<%~ include("@package", { pkg: it.context.packages[0], fenceFor: it.fenceFor }) %>
<% } %><% if (it.context.refDiff && it.context.refDiff.trim()) { %>
<%~ include("@diff", { heading: "Package diff", diff: it.context.refDiff, fenceFor: it.fenceFor }) %>
<% } %>

<%~ include(it.tail) %>
