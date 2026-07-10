<%~ include("@header") %>

`TODO.md` holds the plan under development. Develop it into a concrete,
implementation-ready plan **in this one turn** — use subagents / internal
iteration to go as deep as needed; there is no further agent-only round after
this one.

### Develop the plan

Spawn a **planning-model subagent** using model `<%= it.model %>` to develop the plan.
The subagent works entirely by editing `TODO.md`:

1. **Explore the codebase before asking anything** — read the relevant files,
   tests, and docs so every question below is one the codebase genuinely
   cannot answer.
2. **Replace the captured input / seed template with a real implementation
   plan** — the files to change, exactly what changes, and why, grounded in
   the codebase.
3. **Iterate internally** (spawn further subagents, reconsider, cross-check)
   until the plan is as complete as it can get without human input. Do not
   leave this to a future round — there isn't one before the human is asked.
4. For every remaining open question, write it near the top of the file with
   a **suggested default** — your best-guess answer, stated plainly, that the
   human can accept as-is. A question with no suggested default is incomplete.
5. Leave `TODO.md` **uncommitted** — the human's turn (`gtd step`) reads it
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
