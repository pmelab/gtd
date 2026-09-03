import { describe, expect, it } from "vitest"
import { QA_FORMAT } from "./OpenQuestions.js"
import { REVIEW_FORMAT } from "./ReviewDoc.js"
import type { SteeringFinding, SteeringFormat } from "./SteeringFormat.js"

/**
 * `SteeringFinding`'s two range invariants ("a range is meaningless without a
 * `line`"; "a range's start line equals `line`") are declared in the type's
 * own doc comment, not enforced by the type itself — a new finding site (or a
 * new format entirely) can violate either with the whole suite green unless
 * something actually asserts it. This drives every built-in format's
 * `validate` over malformed content and checks the invariant on every finding
 * returned, so it catches a future violation regardless of which site
 * introduces it.
 */
const assertRangeInvariants = (findings: readonly SteeringFinding[]): void => {
  for (const finding of findings) {
    if (finding.range === undefined) continue
    expect(finding.line, `range without a line: ${JSON.stringify(finding)}`).not.toBeUndefined()
    expect(finding.range.start.line, `range.start.line !== line: ${JSON.stringify(finding)}`).toBe(
      finding.line,
    )
  }
}

const MALFORMED_SAMPLES: readonly (readonly [string, SteeringFormat, string])[] = [
  [
    "qa: bare heading, misordered sections, indented dropped heading/option",
    QA_FORMAT,
    [
      "## Answered Questions",
      "",
      "### Answered already",
      "",
      "Use tRPC.",
      "",
      "## Open Questions",
      "",
      "###",
      "",
      "    ### dropped heading",
      "",
      "    - [ ] dropped option",
      "",
    ].join("\n"),
  ],
  ["review: missing header/base, no chunks", REVIEW_FORMAT, "Just some text\n"],
  [
    "review: chunk with no pointers, wrong first block",
    REVIEW_FORMAT,
    [
      "Not a heading first.",
      "",
      "# Review: abc1234",
      "<!-- base: abc1234def5678901234567890123456789abcd -->",
      "",
      "## Untouched chunk",
      "",
      "no pointers here.",
      "",
    ].join("\n"),
  ],
  [
    "qa: an orphan and duplicate footnote marker/definition",
    QA_FORMAT,
    [
      "## Open Questions",
      "",
      "### Which option?",
      "",
      "- [ ] Option A[^missing]",
      "- [ ] Option B[^dup]",
      "- [ ] _your answer_",
      "",
      "[^dup]: first",
      "",
      "[^dup]: second",
      "",
    ].join("\n"),
  ],
]

describe("SteeringFinding range invariants", () => {
  it.each(MALFORMED_SAMPLES)("%s", (_label, format, content) => {
    const findings = format.validate(content)
    expect(findings.length).toBeGreaterThan(0)
    assertRangeInvariants(findings)
  })
})
