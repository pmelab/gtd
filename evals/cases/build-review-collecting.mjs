// `build.review.collecting`: judges whether a review round is actionable.
// `.gtd/REVIEW_RAW.md`'s content is inlined verbatim into the prompt (see
// `it.read` in `unified.yaml`), so this fixture authors that narrative
// directly rather than any real git history. Two-sided by construction:
// `violation`'s round carries a hand-edit note that MUST become a classified
// concern in `.gtd/REQUIREMENTS.md`; `clean`'s round is a bare approving
// remark that MUST NOT produce one — consuming the capture with no other
// change IS the sign-off.
export default Object.freeze({
  name: "build-review-collecting",
  state: "build.review.collecting",
  // A real code-level identifier (a file path), not an invented label — a
  // classifying agent naturally names the affected file when writing a
  // concern down, but only when the path is the grammatical subject of the
  // human's OWN quoted sentence below; mentioned only in surrounding
  // scene-setting prose, a classifying agent paraphrases it away.
  plantedIdentifier: "src/retry.ts",
  artifact: ".gtd/REQUIREMENTS.md",
  base: {
    "src/retry.ts": `export const withRetry = async <T>(fn: () => Promise<T>): Promise<T> => fn()
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
  },
  expect: {
    violation: {
      gtdFiles: [".gtd/REQUIREMENTS.md", ".gtd/REVIEW_RAW.md"],
      otherFiles: "none",
    },
    clean: { gtdFiles: [".gtd/REVIEW_RAW.md"], otherFiles: "none" },
  },
})
