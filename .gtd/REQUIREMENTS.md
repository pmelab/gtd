# Requirements

## Concerns

### 1. Delete the duplicated jev auto-selection scenario — TECHNICAL

**`tests/integration/features/judge-run.feature` carries the scenario "no
--provider with TYPESAFE_API_KEY set answers through jev, not claude" twice**:
lines 265-283 and 285-303 are byte-identical, left behind by the judge_sonnet
flag cleanup (Greptile P2 on PR 375).

- **Keep the first copy (line 265), delete the second (line 285)** — its
  `@inmem` tag, scenario body, and one surrounding blank line, so the next
  scenario ("--model reaches claude's argv") keeps its `@inmem` tag and spacing
- **No other scenario, step definition, or source file changes**
- Done when: the scenario title appears exactly once in the file, and `npm test`
  stays green

### 2. Drop the two parked deferred review notes — TECHNICAL

**The human's sketch deleted both `## Deferred review notes` sections from
`.gtd/TODO.md`** (836985b note-3, restore the empty-stdout assertion in the
garbled-flag CLI test; daed27f note-2, strengthen the `gtd history list`
kept-tip scenario). Removing them is the human's decision: neither note is built
here.

- **Neither note becomes work in this process**
- `.gtd/TODO.md` ends without those sections, as the sketch left it

## Answered Questions

### Which copy of the duplicated scenario stays?

The first (line 265); the sketch says so explicitly, and the copies are
identical, so the choice changes nothing.

### Do the deleted deferred review notes get built anyway?

No; the human removed them in the same sketch, which settles them as dropped.
