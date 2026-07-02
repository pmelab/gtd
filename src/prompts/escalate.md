## Task: Escalate — the test gate is stuck

A committed `ERRORS.md` is present: the automatic fix loop hit the fix-attempt
cap without getting the tests green. Automatic fixing has stopped so it does not
burn further effort on a problem it cannot solve.

### What to do

1. **Surface the failure** — read `ERRORS.md` and show the user the captured
   failing output verbatim (assertions, stack traces), not a summary.
2. **Report** that the fix attempts were exhausted and the root cause needs
   human judgement.
3. **Tell the user how to resume** — investigate and fix the root cause (or
   nudge the code), then **delete `ERRORS.md`**. Removing `ERRORS.md` resets the
   fix-attempt budget: the next gtd run re-tests and grants a fresh round of
   automatic fixes before escalating again. While `ERRORS.md` exists, every run
   resolves straight back to this gate.
