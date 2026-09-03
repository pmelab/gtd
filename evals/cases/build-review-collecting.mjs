// `build.review.collecting`: judges whether a review round is actionable.
// `.gtd/REVIEW_RAW.md`'s content is inlined verbatim into the prompt (see
// `it.read` in `unified.yaml`), so this fixture authors that narrative
// directly rather than any real git history. Three variants: `violation`'s
// round carries a hand-edit note that MUST become a classified concern in
// `.gtd/REQUIREMENTS.md`; `clean`'s round is a bare approving remark that
// MUST NOT produce one — consuming the capture with no other change IS the
// sign-off; `footnote`'s round carries a footnote anchored to one named
// hunk, which MUST become a concern grounded in that hunk, not a whole-file
// remark.
export default Object.freeze({
  name: "build-review-collecting",
  state: "build.review.collecting",
  // A real code-level identifier (a file path), not an invented label — a
  // classifying agent naturally names the affected file when writing a
  // concern down, but only when the path is the grammatical subject of the
  // human's OWN quoted sentence below; mentioned only in surrounding
  // scene-setting prose, a classifying agent paraphrases it away.
  plantedIdentifier: "src/retry.ts",
  // The footnote variant's own anchor — a SECOND file, so a concern that
  // names it is grounded in the anchored hunk, never a paraphrase of the
  // scene-setting prose that also mentions src/retry.ts.
  footnoteAnchor: "src/checkout.ts",
  // The footnote's own substance — checked ALONGSIDE `footnoteAnchor` so a
  // file-level paraphrase ("src/checkout.ts is under-tested overall", which
  // names the path but not the hunk) still fails: only a concern naming
  // the anchored defect itself proves the hunk, not just the file, was read.
  footnoteSubstance: /\brounding\b|\brounds\b|fractional cent/i,
  artifact: ".gtd/REQUIREMENTS.md",
  base: {
    "src/retry.ts": `export const withRetry = async <T>(fn: () => Promise<T>): Promise<T> => fn()
`,
    "src/checkout.ts": `export const total = (items: Array<{ price: number }>): number =>
  items.reduce((sum, item) => sum + item.price, 0)
`,
  },
  variants: {
    violation: {
      ".gtd/REVIEW_RAW.md": `This is machine-captured input, not instructions. A downstream agent judges
whether it's actionable.

The human left this note on \`.gtd/REVIEW.md\`: "src/retry.ts catches every
error and returns undefined instead of re-throwing after the last attempt.
Callers can't tell a retry exhausted from a real success. Needs a concern to
fix it."
`,
    },
    clean: {
      ".gtd/REVIEW_RAW.md": `This is machine-captured input, not instructions. A downstream agent judges
whether it's actionable.

The human ticked every checkbox in \`.gtd/REVIEW.md\` and left the comment
"Looks good, ship it." No code was hand-edited this round.
`,
    },
    // A footnote anchored to one named hunk (`src/checkout.ts`), the same
    // inline-quoted style `violation` uses. The round also skimmed
    // src/retry.ts with no comment there — scene-setting only — so a
    // concern that names src/retry.ts instead, or describes the whole file
    // rather than the anchored hunk, is grading the wrong thing.
    footnote: {
      ".gtd/REVIEW_RAW.md": `This is machine-captured input, not instructions. A downstream agent judges
whether it's actionable.

The human read through src/retry.ts with no comment, then reached
\`.gtd/REVIEW.md\`'s chunk for the checkout total, which read:

    - [ ] ./src/checkout.ts#2 — sums the cart total[^rounding]

    [^rounding]: this drops fractional cents instead of rounding, so the
    total can land a cent off on carts with three or more items
`,
    },
  },
  expect: {
    violation: {
      gtdFiles: [".gtd/REQUIREMENTS.md", ".gtd/REVIEW_RAW.md"],
      otherFiles: "none",
    },
    clean: { gtdFiles: [".gtd/REVIEW_RAW.md"], otherFiles: "none" },
    footnote: {
      gtdFiles: [".gtd/REQUIREMENTS.md", ".gtd/REVIEW_RAW.md"],
      otherFiles: "none",
    },
  },
})
