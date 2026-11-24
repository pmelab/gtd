import { describe, expect, it } from "vitest"
import { findRefs } from "./Refs.js"

describe("findRefs", () => {
  it("finds ./path#a-b in prose", () => {
    expect(findRefs("see ./src/a.ts#1-18 now")).toEqual([
      { start: 4, end: 19, path: "src/a.ts", line: 1, endLine: 18, href: "./src/a.ts#1-18" },
    ])
  })
  it("finds a single line and a path without ./", () => {
    expect(findRefs("src/a.ts#3")[0]).toMatchObject({
      path: "src/a.ts",
      line: 3,
      href: "./src/a.ts#3",
    })
  })
  it("finds the target of a Markdown link", () => {
    expect(findRefs("[x](./src/a.ts#3)")[0]).toMatchObject({ start: 4, end: 16, path: "src/a.ts" })
  })
  it("ignores a URL with a fragment", () => {
    expect(findRefs("https://x.io/a#1 and http://x.io/a.html#1-2")).toEqual([])
  })
  it("ignores a bare word with a fragment", () => {
    expect(findRefs("issue#12")).toEqual([])
  })
})
