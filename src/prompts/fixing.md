## Task: Fix the package against `FEEDBACK.md`

The feedback is reproduced inline below in the **Feedback to address** section.
It holds either captured test-failure output (from a failed test run) or
agentic-review findings — in both cases, the authoritative list of what to fix.
Do **not** try to read `FEEDBACK.md` from disk: this gtd run has already
committed its removal, so the inlined copy below is the only source.

### Orchestration

Spawn a **fix subagent** using model `{{MODEL}}` to apply the fixes:

1. **Work through the Feedback to address section below** — address every item
   it lists. For test output, make the failing tests pass; for review findings,
   satisfy each finding against the package's task specs.
2. **Make the fix in place** — change the code to resolve the feedback. Keep the
   change focused; do not refactor unrelated code.
3. **Leave every change uncommitted** — do **not** commit or stage. This gtd run
   already removed `FEEDBACK.md`; the next gtd run commits your fix and re-runs
   the tests (and, for a review fix, re-reviews the package).

Re-run gtd once the fix is in place — the fix returns through the test gate.
