/** A `.gtd/REVIEW.md` on the fixture calculator, one hunk per note. */
export const reviewDoc = (...notes: string[]): string =>
  [
    "# Review: abc1234",
    "",
    "<!-- base: 0000000 -->",
    "",
    "## calc",
    "",
    ...notes.flatMap((note, i) => [`- [ ] ./src/calc.ts#${i + 1}-${i + 1}`, `  ${note}`]),
    "",
  ].join("\n")
