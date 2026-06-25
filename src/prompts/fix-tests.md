## Test gate failed

`npm run test` failed. The captured failure output is shown below.

### Fix loop (run internally, do not commit per attempt)

1. **Read the attempt log.** If `ERRORS.md` exists, read it first — it holds the
   running log of previous attempts and what was already tried. Do not repeat a
   failed approach.
2. **Make exactly ONE fix**, then re-run the tests.
3. **Append the attempt to `ERRORS.md`** (leave it uncommitted): the failing
   signature and what you changed. This is the memory that survives across
   attempts.
4. Loop up to **3 attempts**. If the same failure signature recurs with no
   progress, stop early and escalate.

The rule: **leave the resolved state uncommitted and let the next cycle's edge
commit it** — never commit a half-finished attempt.

- **On success** (tests green): leave **all** the fix changes uncommitted and
  delete the uncommitted `ERRORS.md`. The next gtd cycle's edge commits the fix
  in a single commit with a `fix(gtd): …` subject **and** a
  `Gtd-Test-Fix: <n>` trailer in the body (the edge derives `<n>` from the
  verify counter). The `Gtd-Test-Fix:` trailer — **not** the `fix(gtd):`
  subject — is the signal the verify/escalate gate counts; the edge always emits
  it. Do **not** stage or commit `TODO.md`; the edge keeps it dirty (the working
  tree should end with only `TODO.md` pending, or otherwise clean).
- **On escalation** (3 attempts exhausted or no progress): leave `ERRORS.md`
  with the full attempt log uncommitted. The next cycle's edge commits
  `ERRORS.md` and the gate stops at the human escalation.

Because attempts are not committed individually, an interrupted loop resumes
from the package-execution commit: `git reset --hard HEAD` discards the partial
work and the loop restarts cold.

**Re-run gtd** and **STOP**. The edge commits the fix and the gate re-evaluates
on the next cycle.

## Failing test output
