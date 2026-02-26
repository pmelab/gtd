import { describe, it, expect } from "@effect/vitest"
import { type LintError, lint } from "./Lint.js"

const validPlan = `# Feature

## Action Items

- [ ] First item
  - Implementation detail
  - Tests: verify first item works
- [ ] Second item
  - Detail
  - Tests: verify second item
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
  - Tests: check it
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
  - Tests: check
`
    const errors = lint(content)
    expect(errors.some((e: LintError) => e.rule === "sections-order")).toBe(true)
  })

  it("does not raise an error for a plan that omits the Learnings section", () => {
    const content = `# Feature

## Action Items

- [ ] Only item
  - Detail
  - Tests: check it

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
  - Tests: check
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

  it("detects unchecked items without Tests sub-bullet", () => {
    const content = `# Title

## Action Items

- [ ] Item
  - Detail but no tests
`
    const errors = lint(content)
    expect(errors.some((e: LintError) => e.rule === "action-item-tests")).toBe(true)
  })

  it("does not require Tests for checked items", () => {
    const content = `# Title

## Action Items

- [x] Done item
  - Detail
- [ ] Pending item
  - Detail
  - Tests: check it
`
    expect(lint(content)).toEqual([])
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
  - Tests: check
`
    expect(lint(content)).toEqual([])
  })
})
