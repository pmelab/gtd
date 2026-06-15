## Appendix: grill-with-docs methodology

Vendored from <https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs>.

Interview the plan relentlessly. Walk down every branch of the design tree,
resolving dependencies between decisions one-by-one. For each question, provide
a recommended answer with reasoning.

Because you cannot talk to the user, every question goes into `## Open
Questions` in `TODO.md` and is answered between runs by the user editing the
file.

### Domain awareness

During codebase exploration, also look for existing documentation:

- A single context lives at the root: `CONTEXT.md` (glossary of terms) and
  `docs/adr/*.md` (architecture decision records).
- A multi-context repo has a `CONTEXT-MAP.md` at the root pointing to per-area
  `CONTEXT.md` and `docs/adr/` files inside `src/<area>/`.

Create these files lazily — only when you have something to write. If no
`CONTEXT.md` exists, create one when the first term is resolved.

### During the session

- **Challenge against the glossary.** When the plan uses a term that conflicts
  with existing language in `CONTEXT.md`, surface the conflict as an Open
  Question.
- **Sharpen fuzzy language.** When the plan uses vague or overloaded terms,
  propose a precise canonical term as the recommendation.
- **Probe with concrete scenarios.** When domain relationships are discussed,
  invent specific scenarios that force precise boundaries between concepts.
- **Cross-reference with code.** When the plan states how something works,
  check whether the code agrees. Surface contradictions as Open Questions.
- **Update `CONTEXT.md` inline.** When a term gets resolved (by inference from
  the docs, or by a user answer), update `CONTEXT.md` in the same commit.
  `CONTEXT.md` is a glossary — no implementation details, no spec, no scratch
  pad.
- **Offer ADRs sparingly.** Only create an ADR when all three are true: the
  decision is **hard to reverse**, **surprising without context**, and **the
  result of a real trade-off**. Skip otherwise.
