# Requirements

## Concern 1 — PRODUCT: Open Questions first, Answered Questions last, enforced

**The rule:** `## Open Questions` comes before every other `##` section of a Q&A
steering file, and `## Answered Questions` comes after every other `##` section.
Everything else sits between them. This is the sketch, verbatim, from
`.gtd/TODO.md`.

**A title and lead prose above `## Open Questions` are fine.** The rule
constrains section order, not the first line of the file — a `#` title, an intro
paragraph, or both may precede the open-questions heading. Only a competing `##`
section may not.

**gtd reports the violation and stops there — it never moves the section.**
`gtd check qa`, `gtd validate`, and the LSP each emit a finding; the author does
the move. No code action, no auto-reorder, no new formatter hook. This matches
every other built-in format, which validates and never rewrites.

**Today nothing states or checks this.** The shared `questionBar` prompt says
open questions go under a heading "near the top" — vague, and it says nothing at
all about where the answered section goes. The `qa` parser finds both sections
by scanning for their headings anywhere in the file and sorts questions by line
number, so any order parses clean.

**Three things change together.** They are one concern because none of them has
a useful acceptance check on its own, and shipping the checker without the
prompt wording would red-light documents the prompt still tells agents to write:

- The `qa` format's validator gains two ordering findings — one for a `##`
  section that precedes `## Open Questions`, one for a `##` section that follows
  `## Answered Questions`.
- The shared prompt text that describes the format is reworded from "near the
  top" to the exact rule, and gains the matching sentence for
  `## Answered Questions` at the bottom. Both the first-lap and the return-lap
  halves of that shared text need it — the return lap is where a question
  actually MOVES from one section to the other, so that is where getting the
  destination position wrong is most likely.
- The user-facing description of the `qa` mode is updated to state the ordering
  rule, since it is now a thing a file can fail on.

**Acceptance:** `gtd check qa` on a file whose `## Answered Questions` precedes
its `## Open Questions` exits non-zero and names the ordering problem; the same
file with the two sections swapped exits 0 silently. Today the first case
exits 0.

**No existing fixture breaks — I checked all nine files that carry either
heading.** `check.feature`, `default-workflow.feature`, `driver-doc.feature`,
`lsp.feature`, `styled-steering.feature`, `steering-modes.feature`,
`validate.feature`, `program.test.ts`, `StepGuards.test.ts` and
`OpenQuestions.test.ts` all put lead prose (never a `##` section) above
`## Open Questions`, and every fixture carrying `## Answered Questions` puts it
last. The `qa` format's built-in sample — prose, then `## Open Questions` — also
stays valid, so `src/SteeringFormats.test.ts`'s clean-sample assertion holds.

**Risk — one doc comment currently promises the opposite.** The `qa` parser's
comment states that questions are returned in document order "regardless of
which section comes first". That sentence stops being true the moment reverse
order is a finding, and must be rewritten in the same change.

## Answered Questions

### What may sit above `## Open Questions` in a Q&A steering file?

A title and lead prose are allowed. The rule is only that `## Open Questions`
precedes every other `##` section — which keeps today's docs, fixtures, and the
built-in sample valid.

### When a file breaks the order, does gtd only report it, or fix it?

Report only. `gtd check qa`, `gtd validate`, and the LSP emit a finding and the
author moves the section; no code action performs the move. This matches how
every other built-in format behaves today.

### Does the rule apply to the `review` steering format too?

No — only to `qa`. A review file has no question sections at all, so there is
nothing to order.

### Is a misplaced section an error that blocks the gate, or a soft warning?

An error. The `qa` format's findings channel carries no severity, and every
other structural problem it reports blocks; inventing a warning level for this
one rule is not worth a new concept.

### What happens when a file has only one of the two sections, or neither?

It passes. The rule constrains the two sections' positions relative to
everything else; a file missing one of them has nothing to violate.

### Do the phase prompts that forbid open questions change?

No. `review-process` explicitly writes no `## Open Questions` section, and
`architecture.author` scopes questions to technical ones. Neither statement is
about position, so neither moves.
