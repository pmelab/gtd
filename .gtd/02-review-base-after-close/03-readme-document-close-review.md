# Document the close-review leaf in the README

Per the global instruction "every significant change is reflected in the readme":
the new `close-review` leaf is a new terminal state and a new review-base rule,
both of which the README's state table, review-base note, and workflow diagram
currently omit.

## Files

- `README.md`
  - Leaf-state table (`:52-64`) — add a `close-review` row, placed FIRST (above
    `review-process`) to reflect its guard priority.
  - Review-base note (`:66-68`) — extend the candidate set to include the latest
    `chore(gtd): close approved review for …` commit.
  - Mermaid workflow diagram (`:112-128`) — add a `close-review` branch and the
    edge that loops back to `verified` after the close commit.

## Content guidance

- Table row (insert before the `review-process` row at `:54`):
  `| `close-review` | `REVIEW.md` dirty with ONLY forward checkbox ticks (`- [ ]`→`- [x]`), nothing else | Discard ticks, delete `REVIEW.md`, commit the close |`
- Review-base note: state that the candidate set is now {parent-branch
  merge-base, last `<!-- base: … -->` review commit, last
  `chore(gtd): close approved review` commit}, still restricted to ancestors of
  HEAD and closest-to-HEAD wins — so the run after a close resolves to
  `verified`.
- Mermaid: add
  `Resolve -->|REVIEW.md ticks only| CloseReview[close-review: close approved review]:::terminal`
  before the `review-process` edge, and an edge
  `CloseReview -.->|auto re-run| Verified`.

## Acceptance criteria

- [ ] README state table includes a `close-review` row positioned to reflect its
      first-in-priority ordering.
- [ ] Review-base note lists the close commit as a base candidate.
- [ ] Mermaid diagram shows the close-review branch and its loop back to
      `verified`.
- [ ] No stale claim remains that a checkbox-only REVIEW.md routes to
      `review-process`.
