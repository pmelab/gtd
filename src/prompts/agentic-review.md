## Task: Agentic review of the built package

The package's accumulated diff has landed. Review it against the package's task
specs and record the verdict in `FEEDBACK.md`.

### Orchestration

Spawn a **reviewing subagent** using model `{{MODEL}}`. The package's task spec
files and its cumulative diff are inlined below by the orchestrator. The
subagent must:

1. **Read the task spec files** — they define the acceptance criteria. Every
   requirement must be checked.
2. **Read the package diff** — examine every hunk to determine whether the
   implementation satisfies the spec.
3. **Always write `FEEDBACK.md`** in the repo root:
   - **Fully satisfies the spec** → write an **empty** `FEEDBACK.md` (zero bytes
     or whitespace only). An empty file is the **approval** signal — the edge
     closes the package.
   - **Does not fully satisfy** → write concrete, actionable findings anchored
     to specific file and symbol names, grouped under short headings, so the fix
     agent can act without re-reading the diff.
4. **Do not edit source files and do not commit** — the reviewer only writes
   `FEEDBACK.md`, left uncommitted.

Re-run gtd — the edge reads `FEEDBACK.md`: an empty file closes the package; a
content-bearing one routes to a fix cycle and then re-reviews.
