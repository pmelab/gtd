## Task: Escalate to the human — the test gate is stuck

The test gate cannot make progress. Either the consecutive `fix(gtd):` attempts
reached the cap, the same failure signature kept recurring with **no progress**,
or a committed `ERRORS.md` from a previous escalation is still present.
Automatic fixing has stopped to avoid burning further effort on a problem it
cannot solve.

### Steps

1. **Re-run the test suite** so the human sees the current failure. The `.gtdrc`
   `testCommand` config takes precedence if set; otherwise determine the test
   command from project configuration (AGENTS.md, `package.json` scripts,
   Makefile, etc.).

2. **Record the attempt log in `ERRORS.md`** — if `ERRORS.md` is not already
   committed, write the failing signature and everything tried so far into it
   and commit it, so this remains a visible human gate until the human acts.

3. **Surface the latest failure output** verbatim — paste the relevant failing
   assertions / stack traces so the human has the concrete signal, not a
   summary.

4. **Report clearly** that the attempts failed to get the tests green and that
   the root cause needs human judgement.

5. **Tell the human how to resume.** They can either:
   - Fix the root cause and commit it with **any non-`fix(gtd):` prefix** (e.g.
     `fix(scope):`, `refactor:`, `chore:`). A non-`fix(gtd):` commit resets the
     iteration counter to 0 and re-enters the test gate fresh, **or**
   - Amend or squash the `fix(gtd):` chain into a single corrected commit so the
     run of consecutive `fix(gtd):` commits no longer trips the cap.

   In all cases, **delete `ERRORS.md`** once the root cause is addressed — while
   it is committed, every run resolves straight back to this escalation gate.

After reporting, **STOP**. Do **not** re-run gtd — the human must act first.
