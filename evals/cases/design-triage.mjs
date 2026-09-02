// `design.triage`: the first planner turn, grouping a raw entry diff into
// classified concerns. Two-sided on the same open-questions bar the workflow
// itself states (`vars.questionBar`): `violation` plants a genuine PRODUCT
// fork with no default the sketch settles, which MUST surface under
// `## Open Questions`; `clean` plants a fully-specified decision, which must
// NOT raise a question — it gets decided silently instead.
export default Object.freeze({
  name: "design-triage",
  state: "design.triage",
  // The one decision the two fixtures disagree about: `violation` leaves it
  // undecided, `clean` settles it outright. The grader tests whether an open
  // question re-raises THIS decision, never whether the document raises any
  // question at all — a triage turn that settles RefundWindowDays and then
  // asks about something genuinely open (what "day" means, what a repeat
  // refund does) is doing its job, and the clean side must not fail it for
  // that.
  settledDecision: "RefundWindowDays",
  plantedIdentifier: "RefundWindowDays",
  artifact: ".gtd/REQUIREMENTS.md",
  base: {
    "src/orders.ts": `export const orders: Array<{ id: string; total: number }> = []
`,
  },
  variants: {
    // Genuinely ambiguous, user-visible, and undecided by the note itself —
    // must become an Open Question naming the identifier.
    violation: {
      ".gtd/TODO.md": `# TODO

Add order refunds. Customers should be able to request a refund on a past
order. We have not decided \`RefundWindowDays\` — how many days after
purchase a refund is still allowed — and the answer changes what the UI
must show customers, so it can't ship without a number.
`,
    },
    // Fully specified — nothing left for a human to decide, so no question
    // is warranted: post-refund order state and partial-refund support are
    // both settled explicitly, closing off the two forks a less complete
    // sketch would leave genuinely open.
    clean: {
      ".gtd/TODO.md": `# TODO

Add order refunds. Customers can request a refund within
\`RefundWindowDays = 30\` days of purchase; requests after that window are
rejected. Refunds are always for the full order amount — there is no partial
refund. A successful refund marks the order's status as \`"refunded"\` and
leaves its total unchanged, so purchase history stays accurate. No further
configuration is required.
`,
    },
    // A RETURN lap, not a first lap: `.gtd/REQUIREMENTS.md` already exists
    // (triage's own prior output), the human ticked an answer to its one
    // open question, and left a footnote alongside that same ticked line —
    // never a substitute for ticking, additional input carried with it.
    // `.gtd/TODO.md` is deliberately absent: in the real workflow `unwind`
    // has already reverted it out of the tree by the time triage runs, and
    // a footnote in `.gtd/TODO.md` could never be re-read here anyway,
    // since triage never rewrites that file — this is the file triage
    // actually rewrites, so deletion is real and gradeable. This turn must
    // fold the ticked answer into the concern's prose, move the question
    // under `## Answered Questions`, and delete the footnote — marker and
    // definition together — leaving no `[^` behind.
    footnote: {
      // `## Open Questions` first, `qa`'s own section-order rule — this
      // file is the human's own gate-answer edit, already valid `qa` before
      // triage ever reads it.
      ".gtd/REQUIREMENTS.md": `## Open Questions

### How many days after purchase is a refund still allowed (\`RefundWindowDays\`)?

- [x] 30 days — matches the existing return-window policy[^enterprise]
- [ ] 60 days
- [ ] _your answer_

[^enterprise]: double check with support before shipping — some enterprise
  customers negotiated a longer refund window in their contracts, so a flat
  30 may not hold for every account.

## Add order refunds

PRODUCT. Customers can request a refund on a past order. Touches
\`src/orders.ts\`.
`,
    },
  },
  expect: {
    violation: { gtdFiles: [".gtd/REQUIREMENTS.md"], otherFiles: "none" },
    clean: { gtdFiles: [".gtd/REQUIREMENTS.md"], otherFiles: "none" },
    footnote: { gtdFiles: [".gtd/REQUIREMENTS.md"], otherFiles: "none" },
  },
})
