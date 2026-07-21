<%~ include("@header") %>

`.gtd/TODO.md` holds the plan under development. Develop it into a concrete,
product-level plan **in this one turn** — use subagents / internal iteration
to go as deep as needed; there is no further agent-only round after this one.

**Scope: product and user-facing decisions only.** Do not decide
implementation details in this file — file/module structure, data models,
library or tech-stack choices, and other architecture questions belong to the
next phase (`.gtd/ARCHITECTURE.md`) and must not be treated as open questions
here.
<% if (it.context.decisionLog && it.context.decisionLog.trim()) { %>
<%~ include("@decision-log", { decisionLog: it.context.decisionLog, fenceFor: it.fenceFor }) %>
<% } %>

### Develop the plan

Spawn a **planning-model subagent** using model `<%= it.model %>` to develop the plan.
The subagent works entirely by editing `.gtd/TODO.md`:

1. **Explore the codebase before asking anything** — read the relevant files,
   tests, and docs so every question below is one the codebase genuinely
   cannot answer.
2. **Replace the captured input / seed template with a real product plan** —
   what to build and why, and the user-facing behavior it should have,
   grounded in the codebase. Leave *how* to build it for the next phase.
3. **Iterate internally** (spawn further subagents, reconsider, cross-check)
   until the plan is as complete as it can get without human input. Do not
   leave this to a future round — there isn't one before the human is asked.
4. For every remaining open question, add it under a `## Open Questions`
   section near the top of the file, one `### <question>` sub-heading per
   question, whose first body line is `Suggested default: <answer>` — your
   best-guess answer, stated plainly, that the human can accept as-is. This
   structure is enforced: a `###` question with no `Suggested default:` line
   blocks your turn — `gtd step agent` refuses until it's fixed. Omit the
   `## Open Questions` section entirely once there are none.
5. Leave `.gtd/TODO.md` **uncommitted** — the human's turn (`gtd step human`) reads it
   next.
<% if (it.context.turnDiff && it.context.turnDiff.trim()) { %>
<%~ include("@diff", { heading: "Latest human input (answers / sketch / review feedback)", diff: it.context.turnDiff, fenceFor: it.fenceFor }) %>

Read the diff above as **feedback, not finished work**:

- Code changes are suggestions — fold them into the plan and re-implement them
  properly, including test coverage, rather than restoring them verbatim.
- Code comments are positional feedback about the code at that location.
- Plan-text changes are global feedback on the plan (or the reviewed work) as
  a whole.
<% } %>

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
