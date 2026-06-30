# Fix: sentinel for empty failing test output

Fix issue #8. When `testCommand` exits non-zero but prints nothing,
`result.output` is `""`. The `runTest` edge action writes that empty string to
FEEDBACK.md, and the next `gatherEvents` computes `feedbackEmpty = true`. The
machine's precedence-2 rule treats an empty FEEDBACK.md as the agentic-review
**approval** signal and routes to `close-package` (`gtd: package done`) instead
of `fixing`. A failing test silently passes the quality gate.

The empty-FEEDBACK-means-approval contract is intentional and load-bearing for
Agentic Review. Do NOT change that semantics. Instead, Testing's red path must
never emit an empty FEEDBACK/ERRORS file: substitute a sentinel string for
whitespace-only output at the single write site.

## What to implement

File: `src/Events.ts`

1. Add a module-level constant near the other `*_FILE` / `*_SUBJECT` constants
   (around lines 29-45, e.g. right after `ERRORS_FILE` on line 33 or after the
   `*_SUBJECT` block). Word it so it reads sensibly both inlined into the Fixing
   prompt (FEEDBACK path) and as a standalone ERRORS.md escalation body (cap
   path):

   ```ts
   const EMPTY_FAILURE_SENTINEL =
     "Test command failed with no output (exit code non-zero)."
   ```

   Optionally include `result.exitCode` in the body text for the operator (see
   step 2).

2. In `case "runTest"` (the red write site is currently at lines 434-436):

   ```ts
   const target = action.capReached ? ERRORS_FILE : FEEDBACK_FILE
   yield * fs.writeFileString(target, result.output)
   yield * git.commitAllWithPrefix(ERRORS_SUBJECT)
   ```

   After computing `target` and before writing, derive the body and write it
   instead of `result.output`:

   ```ts
   const target = action.capReached ? ERRORS_FILE : FEEDBACK_FILE
   const body = /\S/.test(result.output)
     ? result.output
     : EMPTY_FAILURE_SENTINEL
   yield * fs.writeFileString(target, body)
   yield * git.commitAllWithPrefix(ERRORS_SUBJECT)
   ```

   The `/\S/` guard mirrors `feedbackEmpty`'s own regex at `src/Events.ts:268`,
   so whitespace-only output (e.g. `"   \n"`) is also treated as empty and
   replaced. This single change covers both the below-cap FEEDBACK.md path and
   the at-cap ERRORS.md path.

3. Do NOT touch the green path (`result.exitCode === 0`, lines 423-432) — it
   never writes a file.

## Out of scope

- No change to `feedbackEmpty`, the machine precedence rules, or the
  empty-FEEDBACK-equals-approval contract.
- No new config flag — the sentinel is unconditional for red runs.

## Files to examine

- `src/Events.ts` — constants block (lines 29-45), `case "runTest"` (red write
  site lines 434-436), `feedbackEmpty` regex (line 268).

## Acceptance criteria

- [ ] `EMPTY_FAILURE_SENTINEL` constant added near the `*_FILE` / `*_SUBJECT`
      constants in `src/Events.ts`, with text that reads well both inlined into
      a Fixing prompt and as a standalone ERRORS.md body.
- [ ] In `case "runTest"`, the body written to `target` is
      `/\S/.test(result.output) ? result.output : EMPTY_FAILURE_SENTINEL`.
- [ ] Both the FEEDBACK.md (below cap) and ERRORS.md (at cap) paths use the
      derived body — neither can write an empty/whitespace-only file on a red
      run.
- [ ] The green path (exitCode 0) is unchanged.
- [ ] `feedbackEmpty` and the machine routing are unchanged.
- [ ] `npm run build` (or `tsc`) succeeds; existing test suite stays green
      (`npm test`).
