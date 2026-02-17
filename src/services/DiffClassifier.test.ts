import { describe, it, expect } from "@effect/vitest"
import { classifyDiff, classifyPrefix } from "./DiffClassifier.js"

const makeDiff = (
  files: Array<{ path: string; isNew?: boolean; hunks: Array<{ header: string; lines: string[] }> }>,
) => {
  let result = ""
  for (const file of files) {
    result += `diff --git a/${file.path} b/${file.path}\n`
    if (file.isNew) {
      result += `new file mode 100644\n`
      result += `index 0000000..def5678\n`
      result += `--- /dev/null\n`
    } else {
      result += `index abc1234..def5678 100644\n`
      result += `--- a/${file.path}\n`
    }
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

    const result = classifyDiff(diff, "TODO.md")

    expect(result.humanTodos).toContain("TODO: refactor this")
    expect(result.humanTodos).not.toContain("const b = 2")
    expect(result.fixes).toContain("const b = 2")
    expect(result.fixes).not.toContain("TODO: refactor this")
  })

  it("classifies hunks with FIX: marker as humanTodos", () => {
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.humanTodos).toContain("FIX: broken logic")
    expect(result.fixes).toBe("")
  })

  it("classifies hunks with FIXME: marker as humanTodos", () => {
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.humanTodos).toContain("FIXME: this is wrong")
  })

  it("classifies hunks with HACK: marker as humanTodos", () => {
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.humanTodos).toContain("HACK: workaround")
  })

  it("classifies hunks with XXX: marker as humanTodos", () => {
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.humanTodos).toContain("XXX: needs attention")
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.humanTodos).toContain("todo: lowercase marker")
  })

  it("returns all-humanTodos for diff with only marker hunks", () => {
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.humanTodos).toContain("TODO: first")
    expect(result.humanTodos).toContain("FIXME: second")
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.fixes).toContain("const newVar = 42")
    expect(result.humanTodos).toBe("")
  })

  it("returns empty strings for empty diff", () => {
    const result = classifyDiff("", "TODO.md")
    expect(result.fixes).toBe("")
    expect(result.feedback).toBe("")
    expect(result.seed).toBe("")
    expect(result.humanTodos).toBe("")
  })

  it("classifies TODO.md additions as feedback regardless of format", () => {
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.feedback).toContain("New item without any marker")
    expect(result.fixes).toBe("")
  })

  it("classifies TODO.md blockquote additions as feedback", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+> This approach is wrong", " "],
          },
        ],
      },
    ])

    const result = classifyDiff(diff, "TODO.md")
    expect(result.feedback).toContain("This approach is wrong")
    expect(result.fixes).toBe("")
  })

  it("classifies mixed TODO.md hunks: blockquotes to feedback, non-blockquotes to feedback for existing file", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+- [x] Check off item", " "],
          },
          {
            header: "@@ -10,3 +11,4 @@",
            lines: [" ## Notes", "+> Need to rethink this", " "],
          },
        ],
      },
    ])

    const result = classifyDiff(diff, "TODO.md")
    expect(result.feedback).toContain("Check off item")
    expect(result.feedback).toContain("rethink")
    expect(result.fixes).toBe("")
  })

  it("classifies TODO.md additions as feedback mixed with other files as fixes", () => {
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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.feedback).toContain("TODO.md")
    expect(result.feedback).toContain("New item")
    expect(result.fixes).toContain("const y = 2")
    expect(result.fixes).not.toContain("TODO.md")
    expect(result.humanTodos).toBe("")
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

    const result = classifyDiff(diff, "TODO.md")

    expect(result.humanTodos).toContain("diff --git a/src/app.ts b/src/app.ts")
    expect(result.humanTodos).toContain("--- a/src/app.ts")
    expect(result.humanTodos).toContain("+++ b/src/app.ts")

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

    const result = classifyDiff(diff, "TODO.md")
    expect(result.humanTodos).toContain("src/foo.ts")
    expect(result.humanTodos).not.toContain("src/bar.ts")
    expect(result.fixes).toContain("src/bar.ts")
    expect(result.fixes).not.toContain("src/foo.ts")
  })

  it("classifies new TODO file diff as seed", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        isNew: true,
        hunks: [
          {
            header: "@@ -0,0 +1,3 @@",
            lines: ["+# Plan", "+- [ ] First task", "+- [ ] Second task"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff, "TODO.md")
    expect(result.seed).toContain("First task")
    expect(result.seed).toContain("Second task")
    expect(result.feedback).toBe("")
    expect(result.humanTodos).toBe("")
    expect(result.fixes).toBe("")
  })

  it("classifies blockquote additions in TODO file as feedback", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,5 @@",
            lines: [" # Plan", "+> This approach is wrong", "+> Try a different strategy", " - [ ] Task"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff, "TODO.md")
    expect(result.feedback).toContain("This approach is wrong")
    expect(result.feedback).toContain("Try a different strategy")
    expect(result.seed).toBe("")
    expect(result.humanTodos).toBe("")
  })

  it("classifies indented blockquote additions in TODO file as feedback", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+  > Nested blockquote feedback", " - [ ] Task"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff, "TODO.md")
    expect(result.feedback).toContain("Nested blockquote feedback")
  })

  it("classifies code file TODO markers as humanTodos", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// TODO: refactor this", " const y = 2"],
          },
        ],
      },
    ])

    const result = classifyDiff(diff, "TODO.md")
    expect(result.humanTodos).toContain("TODO: refactor this")
    expect(result.feedback).toBe("")
    expect(result.seed).toBe("")
  })

  it("classifies non-blockquote TODO.md additions as feedback (not seed) for existing files", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+- [ ] New task added", " "],
          },
        ],
      },
    ])

    const result = classifyDiff(diff, "TODO.md")
    expect(result.feedback).toContain("New task added")
    expect(result.seed).toBe("")
  })
})

describe("classifyPrefix", () => {
  it("returns 🌱 for new TODO file (seed)", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        isNew: true,
        hunks: [
          {
            header: "@@ -0,0 +1,3 @@",
            lines: ["+# Plan", "+- [ ] First task"],
          },
        ],
      },
    ])

    expect(classifyPrefix(diff, "TODO.md")).toBe("🌱")
  })

  it("returns 💬 for feedback on existing TODO file", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+> Rethink this approach", " "],
          },
        ],
      },
    ])

    expect(classifyPrefix(diff, "TODO.md")).toBe("💬")
  })

  it("returns 🤦 for code file with TODO markers", () => {
    const diff = makeDiff([
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// TODO: refactor this", " const y = 2"],
          },
        ],
      },
    ])

    expect(classifyPrefix(diff, "TODO.md")).toBe("🤦")
  })

  it("returns 👷 for plain code fixes", () => {
    const diff = makeDiff([
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

    expect(classifyPrefix(diff, "TODO.md")).toBe("👷")
  })

  it("returns 🌱 when seed is mixed with fixes (seed > 👷)", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        isNew: true,
        hunks: [
          {
            header: "@@ -0,0 +1,3 @@",
            lines: ["+# Plan", "+- [ ] First task"],
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

    expect(classifyPrefix(diff, "TODO.md")).toBe("🌱")
  })

  it("returns 🌱 when seed is mixed with feedback and humanTodos (seed > all)", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        isNew: true,
        hunks: [
          {
            header: "@@ -0,0 +1,3 @@",
            lines: ["+# Plan", "+- [ ] First task"],
          },
        ],
      },
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// TODO: refactor", " const y = 2"],
          },
        ],
      },
    ])

    expect(classifyPrefix(diff, "TODO.md")).toBe("🌱")
  })

  it("returns 💬 when feedback is mixed with humanTodos (💬 > 🤦)", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+> Rethink this", " "],
          },
        ],
      },
      {
        path: "src/app.ts",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" const x = 1", "+// TODO: fix this", " const y = 2"],
          },
        ],
      },
    ])

    expect(classifyPrefix(diff, "TODO.md")).toBe("💬")
  })

  it("returns 💬 when feedback is mixed with fixes (💬 > 👷)", () => {
    const diff = makeDiff([
      {
        path: "TODO.md",
        hunks: [
          {
            header: "@@ -1,3 +1,4 @@",
            lines: [" # Plan", "+- [ ] New task", " "],
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

    expect(classifyPrefix(diff, "TODO.md")).toBe("💬")
  })

  it("returns 🤦 when humanTodos are mixed with fixes (🤦 > 👷)", () => {
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

    expect(classifyPrefix(diff, "TODO.md")).toBe("🤦")
  })

  it("returns 🤦 for empty diff", () => {
    expect(classifyPrefix("", "TODO.md")).toBe("🤦")
  })
})
