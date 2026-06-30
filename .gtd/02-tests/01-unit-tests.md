# Unit tests: empty-output red runs write the sentinel

Add unit tests in `src/Events.test.ts` proving the issue-#8 fix: a red test run
with empty (or whitespace-only) output writes a **non-empty** FEEDBACK.md /
ERRORS.md containing the sentinel, never an empty file.

Depends on Package 01 (the fix). These tests will fail on the pre-fix code.

## Context

The existing red-path tests are at `src/Events.test.ts:587-609`:

- `runTest red under cap` (587-597) — `{ exitCode: 1, output: "FAIL: boom\n" }`
  → FEEDBACK.md exists, contains `"FAIL: boom"`, commit `gtd: errors`.
- `runTest red at cap` (599-609) — `{ kind: "runTest", capReached: true }`,
  `{ exitCode: 1, output: "FAIL: persistent\n" }` → ERRORS.md exists,
  FEEDBACK.md absent, commit `gtd: errors`.

The `runPerform(action, testResult)` helper is defined at lines 82-92; the
second arg defaults to `{ exitCode: 0, output: "" }`. Use `existsSync`,
`readFileSync`, `git("log", "-1", "--format=%s")` exactly as the existing tests
do.

## What to implement

Add new `it(...)` cases mirroring the existing two:

1. **Red below cap, empty output** — drive `perform` with
   `{ kind: "runTest", errorCount: 1, capReached: false }` and
   `{ exitCode: 1, output: "" }`. Assert:
   - FEEDBACK.md exists,
   - its contents are non-empty (`/\S/.test(readFileSync(...))` is true),
   - the contents contain the sentinel text (assert on a stable substring of
     `EMPTY_FAILURE_SENTINEL`, e.g. `"failed with no output"` — keep it loose
     enough to survive optional exitCode interpolation),
   - ERRORS.md absent,
   - last commit subject is `gtd: errors`.

2. **Red at cap, empty output** — drive with
   `{ kind: "runTest", errorCount: 3, capReached: true }` and
   `{ exitCode: 1, output: "" }`. Assert:
   - ERRORS.md exists and is non-empty (contains the sentinel),
   - FEEDBACK.md absent,
   - last commit subject is `gtd: errors`.

3. **Whitespace-only output is treated as empty** — drive below cap with
   `{ exitCode: 1, output: "   \n" }`. Assert FEEDBACK.md contents are non-empty
   and contain the sentinel (the `/\S/` guard replaces whitespace-only output,
   matching `feedbackEmpty`'s regex at `src/Events.ts:268`).

Match the surrounding test style: same
`writeFileSync(join(repoDir, "impl.ts"), ...)` setup the existing red cases use
so there is a pending tree, same assertion helpers.

## Files to examine

- `src/Events.test.ts` — existing red tests (587-609), `runPerform` helper
  (82-92), imports for `existsSync` / `readFileSync` / `join`.
- `src/Events.ts` — `EMPTY_FAILURE_SENTINEL` text (added in Package 01) so the
  substring assertion matches.

## Acceptance criteria

- [ ] New test: red below cap with `output: ""` → FEEDBACK.md exists, non-empty,
      contains the sentinel substring; ERRORS.md absent; commit `gtd: errors`.
- [ ] New test: red at cap with `output: ""` → ERRORS.md exists, non-empty,
      contains the sentinel; FEEDBACK.md absent; commit `gtd: errors`.
- [ ] New test: whitespace-only output (`"   \n"`) below cap → FEEDBACK.md
      non-empty, contains the sentinel.
- [ ] Substring assertion uses a stable fragment of the sentinel that tolerates
      optional `exitCode` interpolation.
- [ ] `npm test` passes (all unit tests green).
