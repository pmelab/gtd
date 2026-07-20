<%~ include("@header") %>

`.gtd/ARCHITECTURE.md` holds the technical plan under development — seeded
from the converged product plan, or, if this is the very first turn on
already-technical input, written directly by the human. Develop it into a concrete,
implementation-ready technical plan **in this one turn** — use subagents /
internal iteration to go as deep as needed; there is no further agent-only
round after this one.

**Scope: technical/architectural decisions only.** Decide file/module
structure, data models, module boundaries, library or tech-stack choices, and
error-handling/concurrency strategy — the *how*, building on the *what*
already settled in this file's product content. Do not re-open or re-litigate
product/user-facing decisions from the prior phase; treat them as settled
context.
<% if (it.context.decisionLog && it.context.decisionLog.trim()) { %>
<%~ include("@decision-log", { decisionLog: it.context.decisionLog, fenceFor: it.fenceFor }) %>
<% } %>

### Develop the architecture

Spawn a **planning-model subagent** using model `<%= it.model %>` to develop the
architecture. The subagent works entirely by editing `.gtd/ARCHITECTURE.md`:

1. **Explore the codebase before asking anything** — read the relevant files,
   tests, and docs so every question below is one the codebase genuinely
   cannot answer.
2. **Replace the seeded/captured content with a real architecture** — the
   files to change, module/data-model structure, and why, grounded in the
   codebase.
3. **Iterate internally** (spawn further subagents, reconsider, cross-check)
   until the architecture is as complete as it can get without human input.
   Do not leave this to a future round — there isn't one before the human is
   asked.
4. For every remaining open question, add it under a `## Open Questions`
   section near the top of the file, one `### <question>` sub-heading per
   question, whose first body line is `Suggested default: <answer>` — your
   best-guess answer, stated plainly, that the human can accept as-is. This
   structure is enforced: a `###` question with no `Suggested default:` line
   blocks your turn — `gtd step-agent` refuses until it's fixed. Omit the
   `## Open Questions` section entirely once there are none.
5. Leave `.gtd/ARCHITECTURE.md` **uncommitted** — the human's turn (`gtd step`)
   reads it next.
<% if (it.context.turnDiff && it.context.turnDiff.trim()) { %>
<%~ include("@diff", { heading: "Latest human input (answers / sketch / review feedback)", diff: it.context.turnDiff, fenceFor: it.fenceFor }) %>

Read the diff above as **feedback, not finished work**:

- Code changes are suggestions — fold them into the architecture and
  re-implement them properly, including test coverage, rather than restoring
  them verbatim.
- Code comments are positional feedback about the code at that location.
- Plan-text changes are global feedback on the architecture (or the reviewed
  work) as a whole.
<% } %>

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
