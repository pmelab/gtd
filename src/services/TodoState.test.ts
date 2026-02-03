import { describe, it, expect } from "@effect/vitest"
import { Effect } from "effect"
import { hasUncheckedItems } from "./TodoState.js"

describe("hasUncheckedItems", () => {
  it("returns true when unchecked items exist", () => {
    const content = `## Work Package
- [x] Done item
- [ ] Pending item
- [x] Another done`
    expect(hasUncheckedItems(content)).toBe(true)
  })

  it("returns false when all items are checked", () => {
    const content = `## Work Package
- [x] Done item
- [x] Another done`
    expect(hasUncheckedItems(content)).toBe(false)
  })

  it("returns false when no checkboxes exist", () => {
    const content = `## Just some text
No checkboxes here`
    expect(hasUncheckedItems(content)).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(hasUncheckedItems("")).toBe(false)
  })

  it("returns true with mixed checked and unchecked", () => {
    const content = `- [x] First
- [ ] Second
- [x] Third
- [ ] Fourth`
    expect(hasUncheckedItems(content)).toBe(true)
  })
})
