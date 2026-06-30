# Plan

Fix issue #8: a failing test that produces no output is treated as approval.

## Problem

In the `runTest` edge action (`src/Events.ts:434-436`), a red run writes
`result.output` verbatim to FEEDBACK.md (below cap) and commits `gtd: errors`:

```ts
const target = action.capReached ? ERRORS_FILE : FEEDBACK_FILE
yield * fs.writeFileString(target, result.output)
yield * git.commitAllWithPrefix(ERRORS_SUBJECT)
```

If `testCommand` exits non-zero but prints nothing (e.g. `false`),
`result.output` is `""`. The next `gatherEvents` computes
`feedbackEmpty = feedbackPresent && !/\S/.test("")` → `true`
(`src/Events.ts:268`). The machine's precedence-2 rule
(`src/Machine.ts:360-368`) treats an **empty** FEEDBACK.md as the agentic-review
approval signal and routes to `close-package` (`gtd: package done`) instead of
`fixing`. A failing test silently passes the quality gate.

The empty-FEEDBACK-means-approval contract is intentional and load-bearing for
Agentic Review (`src/prompts/agentic-review.md`, STATES.md §Agentic Review /
§Close package). So the fix must NOT change the empty-equals-approval semantics;
instead Testing's red path must never emit an empty FEEDBACK/ERRORS file.

## Fix

Gate the file content on exit code at the single write site in `runTest`
(`src/Events.ts`, `case "runTest"`). A non-zero exit always means failure, so
when the captured output has no non-whitespace content, write a sentinel string
instead of the empty `result.output`.

- Add a module-level constant near the other `*_SUBJECT` / `*_FILE` constants in
  `src/Events.ts` (around lines 30-42), e.g.
  `const EMPTY_FAILURE_SENTINEL = "Test command failed with no output (exit code non-zero)."`
  Word it so it reads sensibly both inlined into the Fixing prompt (FEEDBACK
  path) and as the standalone ERRORS.md escalation body (cap path).
- In `case "runTest"`, after computing `target` and before writing, derive the
  body:
  `const body = /\S/.test(result.output) ? result.output : EMPTY_FAILURE_SENTINEL`
  (optionally include `result.exitCode` in the sentinel text for the operator).
  Write `body` instead of `result.output` to `target`. This covers both the
  below-cap FEEDBACK.md path and the at-cap ERRORS.md path, so an empty failing
  run also produces a non-empty ERRORS.md at Escalate.
- The green path (`result.exitCode === 0`) is untouched — it never writes a
  file.

This is purely a write-site change. `feedbackEmpty` / the machine routing stay
as-is: the only producer of an empty FEEDBACK.md remains Agentic Review's
deliberate approval, never a red test run.

## Files to change

- `src/Events.ts` — add `EMPTY_FAILURE_SENTINEL` constant; in `case "runTest"`
  substitute the sentinel for whitespace-only `result.output` before writing
  FEEDBACK/ERRORS.
- `README.md` — line ~266 ("When Testing's run is red, it writes the captured
  output…") and the Testing row in the state table (~line 235): note that a red
  run with empty output writes a sentinel so the file is never empty (empty
  FEEDBACK stays reserved for agentic-review approval). Keep STATES.md as-is per
  MEMORY.md (README documents the shipped machine; STATES.md is the target
  redesign).

## Tests

### Unit (`src/Events.test.ts`)

Mirror the existing `runTest red under cap` / `runTest red at cap` tests (lines
587-609). Add two cases driving `perform` with the mock `TestRunner`:

- red below cap, empty output: `{ exitCode: 1, output: "" }` → FEEDBACK.md
  exists, is non-empty (`/\S/.test(contents)` true), contains the sentinel;
  commit `gtd: errors`.
- red at cap, empty output: `{ kind: "runTest", capReached: true }`,
  `{ exitCode: 1, output: "" }` → ERRORS.md exists and is non-empty (sentinel),
  FEEDBACK.md absent.

Also keep/confirm the existing whitespace-only check: an output of `"   \n"` is
treated as empty and replaced (the `/\S/` guard, matching `feedbackEmpty`'s own
regex at `src/Events.ts:268`).

### Integration (`tests/integration/features/testing.feature`)

Add a scenario (composable Given steps already exist —
`a commit … that adds … with`, `a gtd config file at ".gtdrc" with`,
`a file … with`, run/assert steps):

- Scenario "A red gate with no output still routes to Fixing, not Close
  package": gate.sh body `exit 1` (no echo), `testCommand: bash gate.sh`, a
  `gtd: planning` package, a pending `src/helper.ts`. Run gtd. Assert: git log
  contains `gtd: errors`; last commit subject is `gtd: fixing`; stdout contains
  `## Task: Fix the package against \`FEEDBACK.md\``; stdout does NOT contain `##
  Task: Close`/`gtd: package done`. This is the exact repro from the issue and
  fails on the current code (which closes the package).

Run the full suite (`npm test` for unit, `npm run test:e2e` for cucumber) before
done.

## Out of scope

- No change to `feedbackEmpty`, the machine precedence rules, or the
  empty-FEEDBACK-equals-approval contract.
- No new config flag — the sentinel is unconditional for red runs.

no open questions — run gtd to plan
