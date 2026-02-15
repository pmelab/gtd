import { describe, it, expect } from "@effect/vitest"
import { isOnlyLearningsModified } from "./LearningsDiff.js"

const makeDiff = (hunks: Array<{ oldStart: number; lines: string[] }>) => {
  let result = "diff --git a/TODO.md b/TODO.md\nindex abc..def 100644\n--- a/TODO.md\n+++ b/TODO.md\n"
  for (const hunk of hunks) {
    result += `@@ -${hunk.oldStart},5 +${hunk.oldStart},5 @@\n`
    result += hunk.lines.join("\n") + "\n"
  }
  return result
}

const todoContent = [
  "# Feature",                   // 1
  "",                             // 2
  "## Action Items",              // 3
  "",                             // 4
  "- [x] Done item",             // 5
  "  - Detail",                   // 6
  "",                             // 7
  "## Learnings",                 // 8
  "",                             // 9
  "- some learning",             // 10
  "",                             // 11
].join("\n")

describe("isOnlyLearningsModified", () => {
  it("returns true when diff only touches Learnings section", () => {
    const diff = makeDiff([{ oldStart: 9, lines: ["+- new learning"] }])
    expect(isOnlyLearningsModified(diff, todoContent)).toBe(true)
  })

  it("returns false when diff touches Action Items section", () => {
    const diff = makeDiff([{ oldStart: 5, lines: ["-- [x] Done item", "+- [ ] Done item"] }])
    expect(isOnlyLearningsModified(diff, todoContent)).toBe(false)
  })

  it("returns false when diff touches both sections", () => {
    const diff = makeDiff([
      { oldStart: 5, lines: ["-- [x] Done item", "+- [ ] Done item"] },
      { oldStart: 9, lines: ["+- new learning"] },
    ])
    expect(isOnlyLearningsModified(diff, todoContent)).toBe(false)
  })

  it("returns false when diff is empty", () => {
    expect(isOnlyLearningsModified("", todoContent)).toBe(false)
  })

  it("returns false when file has no Learnings section", () => {
    const noLearnings = [
      "# Feature",
      "",
      "## Action Items",
      "",
      "- [x] Done item",
      "",
    ].join("\n")
    const diff = makeDiff([{ oldStart: 5, lines: ["+- new line"] }])
    expect(isOnlyLearningsModified(diff, noLearnings)).toBe(false)
  })

  it("returns true when changes are at the end of Learnings section", () => {
    const diff = makeDiff([{ oldStart: 10, lines: ["+- another learning"] }])
    expect(isOnlyLearningsModified(diff, todoContent)).toBe(true)
  })

  it("returns false when diff touches line before Learnings header", () => {
    const diff = makeDiff([{ oldStart: 7, lines: ["+some text"] }])
    expect(isOnlyLearningsModified(diff, todoContent)).toBe(false)
  })

  it("returns true when hunk starts exactly at Learnings header", () => {
    const diff = makeDiff([{ oldStart: 8, lines: [" ## Learnings", "+- new learning"] }])
    expect(isOnlyLearningsModified(diff, todoContent)).toBe(true)
  })

  it("returns true when entire Learnings section is removed", () => {
    const diff = makeDiff([{
      oldStart: 8,
      lines: [
        "-## Learnings",
        "-",
        "-- some learning",
        "-",
      ],
    }])
    expect(isOnlyLearningsModified(diff, todoContent)).toBe(true)
  })

  it("handles file with content after Learnings section", () => {
    const contentWithMore = [
      "# Feature",                   // 1
      "",                             // 2
      "## Action Items",              // 3
      "",                             // 4
      "- [x] Done",                  // 5
      "",                             // 6
      "## Learnings",                 // 7
      "",                             // 8
      "- learning",                  // 9
      "",                             // 10
      "## Notes",                     // 11
      "",                             // 12
      "Some notes",                  // 13
    ].join("\n")

    const diffInLearnings = makeDiff([{ oldStart: 9, lines: ["+- new learning"] }])
    expect(isOnlyLearningsModified(diffInLearnings, contentWithMore)).toBe(true)

    const diffInNotes = makeDiff([{ oldStart: 13, lines: ["+more notes"] }])
    expect(isOnlyLearningsModified(diffInNotes, contentWithMore)).toBe(false)
  })
})
