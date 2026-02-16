import { describe, it, expect } from "@effect/vitest"
import { Option } from "effect"
import {
  detectState,
  hasUncheckedItems,
  extractLearnings,
  filterLearnings,
  hasLearningsSection,
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

## Learnings

- Some learning
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

describe("extractLearnings", () => {
  it("extracts learnings section content", () => {
    const result = extractLearnings(validPlan)
    expect(result).toContain("Some learning")
  })

  it("returns empty string when no learnings section", () => {
    expect(extractLearnings(minimalValid)).toBe("")
  })

  it("stops at next section", () => {
    const content = `## Learnings

- learning 1
- learning 2

## Next Section

- not a learning
`
    const result = extractLearnings(content)
    expect(result).toContain("learning 1")
    expect(result).toContain("learning 2")
    expect(result).not.toContain("not a learning")
  })
})

describe("filterLearnings", () => {
  it("keeps actionable guidelines with 'always'", () => {
    const input = "- always use Effect.gen for async flows"
    expect(filterLearnings(input)).toBe("- always use Effect.gen for async flows")
  })

  it("keeps actionable guidelines with 'never'", () => {
    const input = "- never use console.log for progress indication"
    expect(filterLearnings(input)).toBe("- never use console.log for progress indication")
  })

  it("keeps actionable guidelines with 'must'", () => {
    const input = "- learnings must only contain actionable coding guidelines"
    expect(filterLearnings(input)).toBe("- learnings must only contain actionable coding guidelines")
  })

  it("keeps actionable guidelines with 'should'", () => {
    const input = "- progress indication should use a proper spinner library"
    expect(filterLearnings(input)).toBe("- progress indication should use a proper spinner library")
  })

  it("keeps actionable guidelines with 'do not' or 'don't'", () => {
    const input = "- do not use plain console.log for spinners"
    expect(filterLearnings(input)).toBe("- do not use plain console.log for spinners")
  })

  it("keeps actionable guidelines with 'avoid'", () => {
    const input = "- avoid duplicating existing instructions"
    expect(filterLearnings(input)).toBe("- avoid duplicating existing instructions")
  })

  it("keeps actionable guidelines with 'prefer'", () => {
    const input = "- prefer Effect.gen over raw pipe chains"
    expect(filterLearnings(input)).toBe("- prefer Effect.gen over raw pipe chains")
  })

  it("keeps actionable guidelines with 'ensure'", () => {
    const input = "- ensure all commits are uninterruptible with rollback"
    expect(filterLearnings(input)).toBe("- ensure all commits are uninterruptible with rollback")
  })

  it("discards state observations with 'currently'", () => {
    const input = "- commitFeedbackCommand currently does a single atomicCommit"
    expect(filterLearnings(input)).toBe("")
  })

  it("discards state observations describing what something 'is'", () => {
    const input = "- atomicCommit in GitService is already Effect.uninterruptible with rollback"
    expect(filterLearnings(input)).toBe("")
  })

  it("discards state observations with 'already'", () => {
    const input = "- generateCommitMessage already accepts an emoji prefix and diff"
    expect(filterLearnings(input)).toBe("")
  })

  it("filters mixed list keeping only actionable items", () => {
    const input = [
      "- commitFeedbackCommand currently does a single atomicCommit with a 🤦 emoji",
      "- generateCommitMessage already accepts an emoji prefix and diff",
      "- always use Effect.gen for async flows",
      "- atomicCommit in GitService is already Effect.uninterruptible",
      "- classification is hunk-level, not file-level",
      "- progress indication should use a proper spinner library, not plain console.log",
      "- learnings must only contain actionable coding guidelines",
    ].join("\n")

    const result = filterLearnings(input)
    expect(result).toContain("always use Effect.gen for async flows")
    expect(result).toContain("progress indication should use a proper spinner library")
    expect(result).toContain("learnings must only contain actionable coding guidelines")
    expect(result).not.toContain("currently does")
    expect(result).not.toContain("already accepts")
    expect(result).not.toContain("is already")
    expect(result).not.toContain("hunk-level")
  })

  it("returns empty string for empty input", () => {
    expect(filterLearnings("")).toBe("")
  })

  it("returns empty string when all items are state observations", () => {
    const input = [
      "- X currently does Y",
      "- Z is already configured",
    ].join("\n")
    expect(filterLearnings(input)).toBe("")
  })

  it("preserves multi-line learning items", () => {
    const input = [
      "- always validate input before processing",
      "  because invalid input causes crashes",
      "- X currently does Y",
    ].join("\n")
    const result = filterLearnings(input)
    expect(result).toContain("always validate input before processing")
    expect(result).toContain("because invalid input causes crashes")
    expect(result).not.toContain("currently does")
  })
})

describe("hasLearningsSection", () => {
  it("returns true when learnings section exists", () => {
    expect(hasLearningsSection(validPlan)).toBe(true)
  })

  it("returns false when no learnings section", () => {
    expect(hasLearningsSection(minimalValid)).toBe(false)
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
