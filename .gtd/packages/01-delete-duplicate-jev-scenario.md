# 01 — Delete the duplicated jev auto-selection scenario

Chore package: declares no tests. **The kept copy at line 265 already covers "no
--provider with TYPESAFE_API_KEY set answers through jev, not claude"** — no
replacement scenario.

## Requirements

1. Delete the duplicated jev auto-selection scenario
2. Leave the two parked deferred review notes untouched

## Tasks

### Task 1: Remove the second scenario copy

Delete lines 285-304 of the feature file: the second `@inmem` tag, the duplicate
scenario body, and one surrounding blank line.

Paths: `tests/integration/features/judge-run.feature`

- [ ] `grep -c "TYPESAFE_API_KEY set answers through jev" tests/integration/features/judge-run.feature`
      returns 1
- [ ] **"--model reaches claude's argv" keeps its `@inmem` tag and one blank
      line above it**
- [ ] First copy (line 265-283) unchanged
- [ ] `npm test` green

### Task 2: Guard the parked deferred review notes

**No edit.** Both `## Deferred review notes` sections (836985b note-3, daed27f
note-2) stay parked.

Paths: `.gtd/TODO.md`

- [ ] `git diff ff365568 -- .gtd/TODO.md` is empty
