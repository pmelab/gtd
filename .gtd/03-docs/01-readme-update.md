# Docs: note the empty-red-run sentinel in README

Update `README.md` to document the issue-#8 fix: a red Testing run with empty
output now writes a sentinel so the FEEDBACK/ERRORS file is never empty (empty
FEEDBACK stays reserved for agentic-review approval).

Depends on Packages 01 and 02 (fix + tests landed). Docs-only, no code.

## Context

Two spots reference the Testing red path:

1. **Testing row of the state table** (`README.md:235`). The Resolution column
   currently reads:
   `... red → write FEEDBACK (below cap) or ERRORS (at cap), commit gtd: errors`.

2. **Test-fix loop prose** (`README.md:266`): "When Testing's run is red, it
   writes the captured output and commits `gtd: errors`, incrementing
   `testFixCount`:".

Also note the Close package row (`README.md:233`) and Agentic Review row (237)
define the empty-FEEDBACK-equals-approval contract — the new wording must make
clear the sentinel keeps that contract intact (a red test never produces an
empty FEEDBACK).

## What to implement

- In the Testing state-table row (line 235), add a short note that a red run
  with empty/whitespace-only output writes a sentinel string so the file is
  never empty.
- In the test-fix loop prose (line ~266), add a sentence: if the captured output
  is empty (e.g. `false` / a command that exits non-zero with no output), a
  sentinel is written instead so FEEDBACK/ERRORS is never empty — empty FEEDBACK
  remains reserved exclusively for Agentic Review's deliberate approval signal.
- Keep wording concise and consistent with the surrounding doc voice.

## Out of scope

- Do NOT edit STATES.md. Per MEMORY.md, README documents the shipped machine;
  STATES.md is the target redesign and is intentionally left as-is.

## Files to examine

- `README.md` — Testing row (235), Close package row (233), Agentic Review row
  (237), test-fix loop section (251-274).

## Acceptance criteria

- [ ] `README.md` Testing row notes the empty-output sentinel.
- [ ] `README.md` test-fix loop prose explains that an empty red run writes a
      sentinel, and that empty FEEDBACK remains reserved for agentic-review
      approval.
- [ ] STATES.md is unchanged.
- [ ] Test suite still green (`npm test`, `npm run test:e2e`) — docs change does
      not break anything.
