## Task: Spec review of the committed package

You are running with a work model. Spawn a **reviewing subagent** using model
`{{MODEL}}` to perform the spec review.

### Subagent instructions

The package's task spec files and the cumulative package diff are both inlined
below by the orchestrator. The subagent must:

1. **Read the task spec files** — these define the acceptance criteria for the
   package. Every spec requirement must be checked.

2. **Read the package diff** — examine every hunk to determine whether the
   implementation satisfies the spec requirements.

3. **Write `FEEDBACK.md`** in the repo root according to these rules:

   - If the implementation **does not fully satisfy** the spec → write concrete,
     actionable feedback anchored to specific file and symbol names so the fix
     agent can act on it without re-reading the diff. Group related findings
     under short headings.
   - If the implementation **fully meets** the spec → write an **empty**
     `FEEDBACK.md` (zero bytes or whitespace only). An empty file is the
     approval signal — the edge treats it as a pass.

4. **Format `FEEDBACK.md`** when it contains content:

   ```sh
   node scripts/gtd.js format FEEDBACK.md
   ```

   Skip this step when the file is intentionally empty.

5. **Do not commit** — leave `FEEDBACK.md` uncommitted. Do not run any other
   git command.

6. **Do not edit source files** — the subagent is a reviewer only.

Re-run gtd — the edge reads `FEEDBACK.md` and either approves (empty) or
routes to a fix cycle (`Gtd-Spec-Review:` trailer).
