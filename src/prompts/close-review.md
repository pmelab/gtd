## Test gate (run first)

Before doing anything else, run the project's test suite (determine the command
from AGENTS.md / `package.json` scripts / Makefile).

- **On failure:** make exactly **ONE** fix, then commit **all** the fix changes
  into a single commit with a `fix(gtd): <desc>` message. Do not commit
  `TODO.md` — leave it dirty (the working tree should end with only `TODO.md`
  pending, or otherwise clean). Then **re-run gtd** and stop; the gate will
  re-evaluate on the next cycle.
- **On green:** proceed inline with the task below in this same run.

## Task: Close the approved review

The review has been approved (all checkboxes ticked, no source file changes).
Discard the ticked checkbox noise and commit the deletion of `REVIEW.md`.

### Steps

1. **Determine the short-sha** — read `REVIEW.md` and extract the full hash from
   the `<!-- base: <full-hash> -->` marker near the top of the file. Take the
   first 7 characters as `<short-sha>`.

2. **Discard working edits** — reset `REVIEW.md` to its committed state so only
   the deletion is recorded (approval is captured by the commit message, not
   checkbox state):

   ```sh
   git checkout -- REVIEW.md
   ```

3. **Stage the deletion**:

   ```sh
   git rm REVIEW.md
   ```

4. **Commit the deletion**:

   ```sh
   git commit -m "chore(gtd): close approved review for <short-sha>"
   ```

   where `<short-sha>` is the 7-character prefix from step 1.
