# Architecture

## Interfaces

No interface change. Both concerns touch only test and steering text — no
signature, type, or contract moves.

## Call Stacks

No call stack change. The deleted scenario is a byte-identical duplicate; the
surviving copy (line 265) exercises the same path.

## E2E Scenarios

No e2e change. **The kept first copy at line 265 already covers "no --provider
with TYPESAFE_API_KEY set answers through jev, not claude"** — deleting the
duplicate removes no behaviour from the suite.

## Unit Tests

### Chores

- chore: tests/integration/features/judge-run.feature — delete lines 285-304:
  the second `@inmem` tag, the duplicate scenario body, and one surrounding
  blank line; **"--model reaches claude's argv" keeps its `@inmem` tag and
  blank-line spacing**; done when
  `grep -c "TYPESAFE_API_KEY set answers through jev"` returns 1 and `npm test`
  stays green (covers 1. Delete the duplicated jev auto-selection scenario)
- chore: .gtd/TODO.md — **no edit**; both `## Deferred review notes` sections
  (836985b note-3, daed27f note-2) stay parked; done when
  `git diff ff365568 -- .gtd/TODO.md` is empty, which it already is (covers 2.
  Leave the two parked deferred review notes untouched)

## Answered Questions

### Should the two concerns merge into one package?

No — footprints share no file (`judge-run.feature` vs `.gtd/TODO.md`), and
concern 2 is a no-op guard, not a change; the single package is concern 1, with
concern 2 as its end-state check.

### Does deleting the duplicate need a replacement scenario?

No — the copies are byte-identical, so the survivor carries full coverage.
