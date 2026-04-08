import { describe, it, expect } from "@effect/vitest"
import { type LintError, lint } from "./Lint.js"

const validPlan = `# Feature

## Action Items

- [ ] First item
  - Implementation detail
- [ ] Second item
  - Detail
- [x] Done item
  - Was implemented

## Open Questions

- Some question?

## Learnings

- Some learning
`

const minimalValid = `# Feature

## Action Items

- [ ] Only item
  - Detail
`

describe("lint", () => {
  it("returns empty array for valid plan", () => {
    expect(lint(validPlan)).toEqual([])
  })

  it("returns empty array for minimal valid plan", () => {
    expect(lint(minimalValid)).toEqual([])
  })

  it("detects missing Action Items section", () => {
    const errors = lint("# Title\n\nSome content")
    expect(errors.some((e: LintError) => e.rule === "sections-present")).toBe(true)
  })

  it("detects wrong section order", () => {
    const content = `# Title

## Open Questions

- question

## Action Items

- [ ] Item
  - Detail
`
    const errors = lint(content)
    expect(errors.some((e: LintError) => e.rule === "sections-order")).toBe(true)
  })

  it("does not raise an error for a plan that omits the Learnings section", () => {
    const content = `# Feature

## Action Items

- [ ] Only item
  - Detail

## Open Questions

- Some question?
`
    expect(lint(content)).toEqual([])
  })

  it("detects blockquotes", () => {
    const content = `# Title

## Action Items

- [ ] Item
  - Detail
  > This should not be here
`
    const errors = lint(content)
    expect(errors.some((e: LintError) => e.rule === "no-blockquotes")).toBe(true)
  })

  it("detects action items without sub-bullets", () => {
    const content = `# Title

## Action Items

- [ ] Item without sub-bullets
`
    const errors = lint(content)
    expect(errors.some((e: LintError) => e.rule === "action-item-format")).toBe(true)
  })

  it("detects TODO comments in checked items", () => {
    const content = `# Title

## Action Items

- [x] Done item
  - <!-- TODO: remove this -->
  - Detail
`
    const errors = lint(content)
    expect(errors.some((e: LintError) => e.rule === "no-todo-comments")).toBe(true)
  })

  it("allows TODO comments in unchecked items", () => {
    const content = `# Title

## Action Items

- [ ] Pending item
  - <!-- TODO: implement this -->
  - Detail
`
    expect(lint(content)).toEqual([])
  })
})
