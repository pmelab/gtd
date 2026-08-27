# Requirements

## Open Questions

### What may sit above `## Open Questions` in a Q&A steering file?

- [ ] Nothing — the file must literally begin with `## Open Questions`.
      Strictest reading of "very top"; forces every author to lead with the
      questions.
- [x] A title and lead prose are allowed — the rule is only that
      `## Open Questions` precedes every OTHER `##` section. Keeps today's docs
      and the built-in sample valid.
- [ ] _your answer_

### When a file breaks the order, does gtd only report it, or fix it?

- [x] Report only — `gtd check qa` / `gtd validate` / the LSP emit a finding and
      the author moves the section. Matches how every other built-in format
      behaves today.
- [ ] Report and offer a one-click fix — same finding, plus an LSP code action
      ("move `## Open Questions` to the top") that performs the move. More
      machinery, but the human never hand-moves a section.
- [ ] _your answer_

## Concern 1 — PRODUCT: Open Questions first, Answered Questions last, enforced

**The rule:** in any Q&A steering file, `## Open Questions` comes at the very
top and `## Answered Questions` at the very bottom; every other section of the
document sits between them. This is the sketch, verbatim, from `.gtd/TODO.md`.

**Today nothing states or checks this.** The shared `questionBar` prompt says
open questions go under a heading "near the top" — vague, and it says nothing at
all about where the answered section goes. The `qa` parser finds both sections
by scanning for their headings anywhere in the file and sorts questions by line
number, so any order parses clean.

**Three things change together.** They are one concern because none of them has
a useful acceptance check on its own, and shipping the checker without the
prompt wording would red-light documents the prompt still tells agents to write:

- The `qa` format's validator gains an ordering finding — a file with
  `## Answered Questions` before `## Open Questions`, or with an ordinary
  section after the answered one, fails to validate.
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

**Risk — the built-in sample may become invalid.** The `qa` format's canonical
sample opens with a prose line before `## Open Questions`, and
`src/SteeringFormats.test.ts` asserts every format's sample validates clean. If
the answer to the first open question is "nothing may sit above it", that sample
must be rewritten in the same change or the suite goes red.

**Risk — existing scenario fixtures.** The `qa` heading appears in fixtures
across at least eight integration feature files. Any fixture that puts prose
above `## Open Questions` (several do) breaks under the strict answer and has to
be edited in the same concern to keep the suite green.

## Answered Questions

### Does the rule apply to the `review` steering format too?

No — only to `qa`. A review file has no question sections at all, so there is
nothing to order.

### Is a misplaced section an error that blocks the gate, or a soft warning?

An error. The `qa` format's findings channel carries no severity, and every
other structural problem it reports blocks; inventing a warning level for this
one rule is not worth a new concept.

### What happens when a file has only one of the two sections, or neither?

It passes. The rule constrains the two sections' positions relative to
everything else; a file missing one of them has nothing to violate. A file with
only `## Answered Questions` is valid under the strict reading too, because the
rule about the answered section is that it comes last, not that an open section
must exist.

### Do the phase prompts that forbid open questions change?

No. `review-process` explicitly writes no `## Open Questions` section, and
`architecture.author` scopes questions to technical ones. Neither statement is
about position, so neither moves.
