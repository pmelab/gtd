<%~ include("@header") %>

The human has approved (and possibly amended) `.gtd/LEARNINGS.md`. Your job is
to integrate those learnings into the project's own memory, not to touch
`.gtd/LEARNINGS.md` itself.

1. **Read `.gtd/LEARNINGS.md`.**
2. **Pick the right home for each point**, using your judgment and this
   project's existing convention:
   - An existing `CLAUDE.md` or `AGENTS.md` at the repo root (or a directory
     closer to what the learning concerns) is usually the right place.
   - If neither exists and the learnings warrant one, create `AGENTS.md` at
     the repo root.
   - A learning about a specific subsystem may fit better in that
     subsystem's own docs than a root-level file — use your judgment.
3. **Integrate, don't just append** — merge each point into the relevant
   section of the target file(s); rephrase for clarity, dedupe against what's
   already documented, and keep the existing document's structure and tone.
4. **Never delete or edit `.gtd/LEARNINGS.md`** — the machine removes it once
   your turn is captured.
5. **Leave every change uncommitted and finish your turn.**

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
