<%~ include("@header") %>

The process is **approved and done**, and headed for a squash. Before that
happens, `.gtd/LEARNINGS.md` has been committed with a template — your job is
to overwrite it with the real, distilled learnings from this cycle so they
survive the squash even though the granular history won't.

### Step 1 — Walk the cycle's history

Scan the git history back to the cycle's start (the full-process diff is
inlined below, and `git log` over the same range shows every `gtd: ...` /
`gtd(agent): ...` / `gtd(human): ...` commit). Look specifically for:

- **Test failures and fixes** — each `gtd: test-failed` round and the fix that
  followed it. What broke, and what actually made it pass?
- **Review feedback** — human `.gtd/REVIEW.md` notes and `gtd: review
  feedback` detours. What did the human have to correct that the agent got
  wrong on its own?
- **Health-check rounds** — any `gtd: health-check` / `gtd: health-fix`
  cycles. Environmental or systemic issues surfaced outside normal building?
- **Grilling decisions** — `.gtd/TODO.md`'s "## Captured input" sections and
  plan edits. Trade-offs or conventions the human specified that a future
  agent should already know.

### Step 2 — Distill, don't transcribe

For each thing you found, ask: is this a **durable, generalizable lesson**
(a convention, a gotcha, a pattern this project wants followed next time), or
a **one-off detail** specific to this change? Keep only the former. A future
agent reading this should learn something that changes how it works on this
project, not a recap of what happened.

### Step 3 — Overwrite .gtd/LEARNINGS.md

Replace the **entire content** of `.gtd/LEARNINGS.md` with your distilled
learnings (plain markdown, no leftover template scaffolding). If nothing
durable surfaced this cycle, write a short explicit note saying so — don't
leave the placeholder text in place. Leave the file uncommitted and finish
your turn; a human reviews it next before it's integrated into the project's
own memory (CLAUDE.md/AGENTS.md/docs).
<% if (it.context.squashDiff && it.context.squashDiff.trim()) { %>
<%= it.context.squashBase !== undefined ? "\nCycle base: " + it.context.squashBase + "\n" : "" %>
<%~ include("@diff", { heading: "Full-process diff (`git diff " + (it.context.squashBase !== undefined ? it.context.squashBase : "<squashBase>") + " HEAD`)", diff: it.context.squashDiff, fenceFor: it.fenceFor }) %>
<% } %>

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
