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

The rule: **only commit on success or escalation** — never commit a
half-finished attempt.

- **On success** (tests green): commit **all** the fix changes in a single
  commit with the `fix(gtd): <desc>` subject **and** a `Gtd-Test-Fix: <n>`
  trailer in the body (where `<n>` is the current attempt number, starting at
  1):
  ```
  git commit -m "fix(gtd): <desc>" -m "Gtd-Test-Fix: <n>"
  ```
  The `Gtd-Test-Fix:` trailer — **not** the `fix(gtd):` subject — is the
  signal the verify/escalate gate counts; it is load-bearing and **must always
  be present** on a test-fix success commit. Then delete the uncommitted
  `ERRORS.md`. Do **not** commit `TODO.md` — leave it dirty (the working tree
  should end with only `TODO.md` pending, or otherwise clean).
- **On escalation** (3 attempts exhausted or no progress): commit `ERRORS.md`
  with the full attempt log so the next cycle stops at the human gate.

Because attempts are not committed individually, an interrupted loop resumes
from the package-execution commit: `git reset --hard HEAD` discards the partial
work and the loop restarts cold.

After committing, **re-run gtd** and **STOP**. The gate will re-evaluate on the
next cycle.

## Failing test output
