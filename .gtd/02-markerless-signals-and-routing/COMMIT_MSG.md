feat(gtd): markerless review signals + review-incomplete leaf

Replace the bang/forward-tick machinery with two edge-computed signals and
route the review branch in the pure machine onto four outcomes.

- Events.ts: drop `bangPresent` and `reviewApprovedNoChanges`; compute
  `reviewHasUncheckedBoxes` (working-tree `- [ ]` present) and
  `reviewHasRealFeedback` (normalize-and-compare via the pure `formatString`,
  plus dirty source / untracked detection).
- Machine.ts: swap the `ResolvePayload` fields, rename `reviewApprovedClose` →
  `closeReview`, add the `reviewIncomplete` guard and the new terminal
  `review-incomplete` leaf, and order the review branch
  `await-review → review-incomplete → close-review → review-process` so the
  unchecked-boxes gate always wins first.
- Prompt.ts: register `review-incomplete` with its new human-gate prompt.

review-process keeps its existing agent-driven prompt for now; the edge flow
lands in a later package.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
