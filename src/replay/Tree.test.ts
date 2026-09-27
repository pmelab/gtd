import { describe, expect, it } from "vitest"
import { diffTrees, type TreeView } from "./Tree.js"

const tree = (files: Record<string, { id?: string; content: string }>): TreeView => ({
  paths: () => Object.keys(files).sort(),
  read: (path) => files[path]?.content,
  id: (path) => files[path]?.id,
})

describe("diffTrees", () => {
  it("compares blob ids where both sides have one, whatever the bytes read", () => {
    const before = tree({ "a.txt": { id: "1", content: "one\n" } })
    const after = tree({ "a.txt": { id: "1", content: "one\r\n" } })
    expect(diffTrees(before, after).modified).toEqual([])
  })

  it("falls back to contents for a path one side has no id for", () => {
    const before = tree({
      "a.txt": { id: "1", content: "one\n" },
      "b.txt": { id: "2", content: "b" },
    })
    const after = tree({ "a.txt": { content: "one\n" }, "b.txt": { content: "changed" } })
    expect(diffTrees(before, after).modified).toEqual(["b.txt"])
  })
})
