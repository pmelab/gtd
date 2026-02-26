import { describe, it, expect } from "@effect/vitest"
import { Option } from "effect"
import {
  detectState,
  hasUncheckedItems,
  parsePackages,
  getNextUncheckedPackage,
} from "./Markdown.js"

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
`

const minimalValid = `# Feature

## Action Items

- [ ] Only item
  - Detail
  - Tests: check it
`

describe("detectState", () => {
  it("returns empty for empty string", () => {
    expect(detectState("")).toBe("empty")
  })

  it("returns empty for whitespace-only", () => {
    expect(detectState("   \n  \n  ")).toBe("empty")
  })

  it("returns no-action-items for content without checkboxes", () => {
    expect(detectState("# Title\n\nSome notes about a feature")).toBe("no-action-items")
  })

  it("returns has-action-items for content with checkboxes", () => {
    expect(detectState(validPlan)).toBe("has-action-items")
  })

  it("returns has-action-items even if all checked", () => {
    expect(detectState("- [x] done\n  - detail")).toBe("has-action-items")
  })
})

describe("hasUncheckedItems", () => {
  it("returns true when unchecked items exist", () => {
    expect(hasUncheckedItems(validPlan)).toBe(true)
  })

  it("returns false when all checked", () => {
    expect(hasUncheckedItems("- [x] done")).toBe(false)
  })

  it("returns false for empty content", () => {
    expect(hasUncheckedItems("")).toBe(false)
  })
})

const packagedPlan = `# Feature

## Action Items

### Agent Error Handling

- [ ] Capture stderr from spawned processes
  - Pipe stderr to buffer
  - Tests: check captured stderr
- [ ] Include stderr in AgentError
  - Add stderr field
  - Tests: verify error message

### Integration Tests

- [ ] Agent spawning tests
  - Create mock executables
  - Tests: verify spawning and exit codes

## Open Questions

- Some question?
`

const partiallyCheckedPackages = `# Feature

## Action Items

### Done Package

- [x] Already done
  - Detail

### Pending Package

- [ ] Still pending
  - Detail
  - Tests: check it

## Open Questions

- Question?
`

describe("parsePackages", () => {
  it("parses packages delimited by ### headings", () => {
    const packages = parsePackages(packagedPlan)
    expect(packages.length).toBe(2)
    expect(packages[0]!.title).toBe("Agent Error Handling")
    expect(packages[0]!.items.length).toBe(2)
    expect(packages[0]!.items[0]!.title).toBe("Capture stderr from spawned processes")
    expect(packages[0]!.items[1]!.title).toBe("Include stderr in AgentError")
    expect(packages[1]!.title).toBe("Integration Tests")
    expect(packages[1]!.items.length).toBe(1)
    expect(packages[1]!.items[0]!.title).toBe("Agent spawning tests")
  })

  it("returns empty when no ### headings", () => {
    const packages = parsePackages(validPlan)
    expect(packages.length).toBe(0)
  })

  it("ignores items before first ### heading", () => {
    const content = `# Feature

## Action Items

- [ ] Orphaned item
  - Detail
  - Tests: check

### Named Package

- [ ] Packaged item
  - Detail
  - Tests: check
`
    const packages = parsePackages(content)
    expect(packages.length).toBe(1)
    expect(packages[0]!.title).toBe("Named Package")
    expect(packages[0]!.items.length).toBe(1)
  })

  it("returns empty array when no Action Items section", () => {
    const packages = parsePackages("# Title\n\nSome content")
    expect(packages.length).toBe(0)
  })

  it("returns empty array for empty content", () => {
    const packages = parsePackages("")
    expect(packages.length).toBe(0)
  })
})

describe("getNextUncheckedPackage", () => {
  it("returns first package with unchecked items", () => {
    const result = getNextUncheckedPackage(packagedPlan)
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.title).toBe("Agent Error Handling")
      expect(result.value.items.length).toBe(2)
    }
  })

  it("skips fully checked packages", () => {
    const result = getNextUncheckedPackage(partiallyCheckedPackages)
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.title).toBe("Pending Package")
    }
  })

  it("returns None when all packages are checked", () => {
    const content = `# Feature

## Action Items

### Done

- [x] Done item
  - Detail
`
    expect(Option.isNone(getNextUncheckedPackage(content))).toBe(true)
  })

  it("returns None for empty content", () => {
    expect(Option.isNone(getNextUncheckedPackage(""))).toBe(true)
  })

  it("returns None for flat format without ### headings", () => {
    expect(Option.isNone(getNextUncheckedPackage(validPlan))).toBe(true)
  })
})
