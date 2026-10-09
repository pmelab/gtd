import { describe, expect, test } from "vitest"

import { accessDenial } from "./access"

const root = "/repo"
const access = { read: ["src/**", "docs/*.md"], write: [".gtd/REVIEW.md"] }

describe("accessDenial", () => {
  test("Read: allowed inside read globs, denied outside naming them", () => {
    expect(accessDenial("Read", { file_path: "src/a/b.ts" }, access, root)).toBeUndefined()
    const denial = accessDenial("Read", { file_path: "README.md" }, access, root)
    expect(denial).toContain("README.md")
    expect(denial).toContain("src/**")
  })

  test.each([
    ["Edit", { file_path: "src/a.ts" }],
    ["MultiEdit", { file_path: "src/a.ts" }],
    ["Write", { file_path: "src/a.ts" }],
    ["NotebookEdit", { notebook_path: "src/a.ipynb" }],
  ])("%s: denied outside write globs", (tool, input) => {
    expect(accessDenial(tool, input, access, root)).toContain(".gtd/REVIEW.md")
  })

  test.each([
    ["Edit", "file_path"],
    ["MultiEdit", "file_path"],
    ["Write", "file_path"],
    ["NotebookEdit", "notebook_path"],
  ])("%s: allowed inside write globs", (tool, key) => {
    expect(accessDenial(tool, { [key]: ".gtd/REVIEW.md" }, access, root)).toBeUndefined()
  })

  test("a null side is unrestricted", () => {
    const open = { read: null, write: null }
    expect(accessDenial("Read", { file_path: "x" }, open, root)).toBeUndefined()
    expect(accessDenial("Write", { file_path: "x" }, open, root)).toBeUndefined()
    expect(accessDenial("Glob", { pattern: "*" }, open, root)).toBeUndefined()
  })

  test("an empty list denies everything on that side", () => {
    expect(accessDenial("Write", { file_path: "x" }, { read: null, write: [] }, root)).toBeDefined()
  })

  test("absolute paths are made repo-relative", () => {
    expect(accessDenial("Read", { file_path: "/repo/src/a.ts" }, access, root)).toBeUndefined()
    expect(accessDenial("Read", { file_path: "/repo/README.md" }, access, root)).toBeDefined()
  })

  test("a path outside the repo passes", () => {
    expect(accessDenial("Write", { file_path: "/etc/hosts" }, access, root)).toBeUndefined()
    expect(accessDenial("Read", { file_path: "../other/x" }, access, root)).toBeUndefined()
  })

  test("Glob/Grep: root inside a literal prefix passes, else denied naming globs", () => {
    for (const tool of ["Glob", "Grep"]) {
      expect(accessDenial(tool, { path: "/repo/src/a" }, access, root)).toBeUndefined()
      expect(accessDenial(tool, { path: "src" }, access, root)).toBeUndefined()
      expect(accessDenial(tool, { path: "/repo/docs" }, access, root)).toBeUndefined()
      expect(accessDenial(tool, { path: "/repo/lib" }, access, root)).toContain("src/**")
      expect(accessDenial(tool, {}, access, root)).toContain("docs/*.md")
    }
  })

  test("Glob/Grep: repo root passes when a read glob starts with a wildcard", () => {
    expect(accessDenial("Grep", {}, { read: ["**/*.md"], write: null }, root)).toBeUndefined()
  })

  test("Bash is never inspected", () => {
    expect(accessDenial("Bash", { command: "cat /repo/secret" }, access, root)).toBeUndefined()
  })

  test("other tools pass", () => {
    expect(accessDenial("WebFetch", { url: "x" }, access, root)).toBeUndefined()
  })
})
