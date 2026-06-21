## Task: Escalate to the human — the test gate is stuck

The test gate has failed too many times in a row. The last N consecutive commits
all carry the `fix(gtd):` prefix, meaning the agent tried to get the test suite
green that many times and never succeeded. The iteration cap has been reached,
so automatic fixing has stopped to avoid burning further effort on a problem it
cannot solve.

### Steps

1. **Re-run the test suite** so the human sees the current failure. Determine
   the test command from project configuration (AGENTS.md, `package.json`
   scripts, Makefile, etc.).

2. **Surface the latest failure output** verbatim — paste the relevant failing
   assertions / stack traces so the human has the concrete signal, not a
   summary.

3. **Report clearly** that N consecutive `fix(gtd):` attempts failed to get the
   tests green and that the root cause needs human judgement.

4. **Tell the human how to resume.** They can either:
   - Fix the root cause and commit it with **any non-`fix(gtd):` prefix** (e.g.
     `fix(scope):`, `refactor:`, `chore:`). A non-`fix(gtd):` commit resets the
     iteration counter to 0 and re-enters the test gate fresh, **or**
   - Amend or squash the `fix(gtd):` chain into a single corrected commit so the
     run of consecutive `fix(gtd):` commits no longer trips the cap.

After reporting, **STOP**. Do **not** re-run gtd — the human must act first.
