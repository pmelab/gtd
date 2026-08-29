// `design.triage`: the first planner turn, grouping a raw entry diff into
// classified concerns. Two-sided on the same open-questions bar the workflow
// itself states (`vars.questionBar`): `violation` plants a genuine PRODUCT
// fork with no default the sketch settles, which MUST surface under
// `## Open Questions`; `clean` plants a fully-specified decision, which must
// NOT raise a question — it gets decided silently instead.
export default Object.freeze({
  name: "design-triage",
  state: "design.triage",
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
    // is warranted.
    clean: {
      ".gtd/TODO.md": `# TODO

Add order refunds. Customers can request a refund within
\`RefundWindowDays = 30\` days of purchase; requests after that window are
rejected with no further configuration needed.
`,
    },
  },
  expect: {
    violation: { gtdFiles: [".gtd/REQUIREMENTS.md"], otherFiles: "none" },
    clean: { gtdFiles: [".gtd/REQUIREMENTS.md"], otherFiles: "none" },
  },
})
