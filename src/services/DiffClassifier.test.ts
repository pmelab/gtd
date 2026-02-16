import { describe, it, expect } from "@effect/vitest"
import { classifyDiff } from "./DiffClassifier.js"

const makeDiff = (files: Array<{ path: string; hunks: Array<{ header: string; lines: string[] }> }>) => {
  let result = ""
  for (const file of files) {
    result += `diff --git a/${file.path} b/${file.path}\n`
    result += `index abc1234..def5678 100644\n`
    result += `--- a/${file.path}\n`
    result += `+++ b/${file.path}\n`
    for (const hunk of file.hunks) {
      result += `${hunk.header}\n`
      result += hunk.lines.join("\n") + "\n"
    }
  }
  return result
}

describe("classifyDiff", () => {
  it("classifies hunks with TODO: marker as feedback", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// TODO: refactor this", " const y = 2"],
          },
          {
            header: "@@ -10,3 +11,4 @@",
            lines: [" const a = 1", "+const b = 2", " const c = 3"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)

    expect(result.feedback).toContain("TODO: refactor this")
    expect(result.feedback).not.toContain("const b = 2")
    expect(result.fixes).toContain("const b = 2")
    expect(result.fixes).not.toContain("TODO: refactor this")
  })

  it("classifies hunks with FIX: marker as feedback", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// FIX: broken logic", " const y = 2"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("FIX: broken logic")
    expect(result.fixes).toBe("")
  })

  it("classifies hunks with FIXME: marker as feedback", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// FIXME: this is wrong", " const y = 2"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("FIXME: this is wrong")
  })

  it("classifies hunks with HACK: marker as feedback", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// HACK: workaround", " const y = 2"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("HACK: workaround")
  })

  it("classifies hunks with XXX: marker as feedback", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// XXX: needs attention", " const y = 2"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("XXX: needs attention")
  })

  it("is case-insensitive for markers", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// todo: lowercase marker", " const y = 2"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("todo: lowercase marker")
  })

  it("returns all-feedback for diff with only marker hunks", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// TODO: first", " const y = 2"],
          },
          {
            header: "@@ -10,3 +11,4 @@",
            lines: [" const a = 1", "+// FIXME: second", " const c = 3"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("TODO: first")
    expect(result.feedback).toContain("FIXME: second")
    expect(result.fixes).toBe("")
  })

  it("returns all-fix for diff with no markers", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+const newVar = 42", " const y = 2"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.fixes).toContain("const newVar = 42")
    expect(result.feedback).toBe("")
  })

  it("returns empty strings for empty diff", () => {
    const result = classifyDiff("")
    expect(result.fixes).toBe("")
    expect(result.feedback).toBe("")
  })

  it("classifies all TODO.md changes as feedback regardless of content", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+- [ ] New item without any marker", " "],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("New item without any marker")
    expect(result.fixes).toBe("")
  })

  it("classifies TODO.md changes as feedback mixed with other file changes", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+- [ ] New item", " "],
          },
        ],
      },
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+const y = 2", " const z = 3"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("TODO.md")
    expect(result.feedback).toContain("New item")
    expect(result.fixes).toContain("const y = 2")
    expect(result.fixes).not.toContain("TODO.md")
  })

  it("preserves file headers in reconstructed diffs", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// TODO: feedback hunk", " const y = 2"],
          },
          {
            header: "@@ -10,3 +11,4 @@",
            lines: [" const a = 1", "+const b = 2", " const c = 3"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)

    expect(result.feedback).toContain("diff --git a/src/app.ts b/src/app.ts")
    expect(result.feedback).toContain("--- a/src/app.ts")
    expect(result.feedback).toContain("+++ b/src/app.ts")

    expect(result.fixes).toContain("diff --git a/src/app.ts b/src/app.ts")
    expect(result.fixes).toContain("--- a/src/app.ts")
    expect(result.fixes).toContain("+++ b/src/app.ts")
  })

  it("handles multiple files with mixed classification", () => {
    const diff = makeDiff([
      {
        path: "src/foo.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// TODO: needs work", " const y = 2"],
          },
        ],
      },
      {
        path: "src/bar.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const a = 1", "+const b = 2", " const c = 3"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff)
    expect(result.feedback).toContain("src/foo.ts")
    expect(result.feedback).not.toContain("src/bar.ts")
    expect(result.fixes).toContain("src/bar.ts")
    expect(result.fixes).not.toContain("src/foo.ts")
  })
})
