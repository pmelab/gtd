## Task: Fix the package against spec-review feedback

You are running with a work model. Spawn a **fix subagent** using model
`{{MODEL}}` to apply the spec-review findings.

### Subagent instructions

A content-bearing `FEEDBACK.md` is present. The package's task spec files are
inlined below by the orchestrator. The subagent must:

1. **Read `FEEDBACK.md`** — this is the authoritative list of spec violations.
   Every finding must be addressed.

2. **Read the task spec files** — use them as the acceptance criteria to
   validate each fix. The goal is for the implementation to fully satisfy the
   spec.

3. **Fix in place** — make the necessary code changes to resolve every finding
   in `FEEDBACK.md`. Do not commit individual fixes.

4. **Delete `FEEDBACK.md`** after all fixes are applied:

   ```sh
   rm FEEDBACK.md
   ```

5. **Leave all changes uncommitted** — the edge commits the fix with a
   `Gtd-Spec-Review:` trailer, re-runs tests, and then re-reviews the package.
   Do not stage or commit anything.

Re-run gtd — the edge commits with the `Gtd-Spec-Review:` trailer, re-tests,
then re-reviews the package against the spec.
