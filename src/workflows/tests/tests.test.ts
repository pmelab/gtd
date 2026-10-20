import { describe, expect, it } from "vitest"
import { DEFAULT_SKIP_PATTERN, skipsIn } from "./tests.js"

const skipped = (text: string): readonly number[] =>
  skipsIn([{ path: "a", text }], new RegExp(DEFAULT_SKIP_PATTERN)).map((s) => s.line)

describe("the default skipPattern", () => {
  it.each([
    'it.skip("x", () => {})',
    'test.skip("x", () => {})',
    'describe.skip("x", () => {})',
    'it.todo("x")',
    'xit("x", () => {})',
    'xdescribe("x", () => {})',
    "  @inmem @skip",
    "@ignore",
  ])("reads %s as skipped", (line) => {
    expect(skipped(line)).toEqual([1])
  })

  it.each([
    'it("x", () => {})',
    'it.skipIf(windows)("x", () => {})',
    'it.only("x", () => {})',
    "@skipped-by-nobody",
    "fixit()",
    "user@skip.example",
  ])("does not read %s as skipped", (line) => {
    expect(skipped(line)).toEqual([])
  })
})

describe("skipsIn", () => {
  it("names every skipped line by path and 1-based line, trimmed", () => {
    expect(
      skipsIn(
        [
          { path: "a.test.ts", text: 'it("a", f)\n  it.skip("b", f)\n' },
          { path: "b.feature", text: "@skip\nScenario: c" },
        ],
        new RegExp(DEFAULT_SKIP_PATTERN),
      ),
    ).toEqual([
      { path: "a.test.ts", line: 2, text: 'it.skip("b", f)' },
      { path: "b.feature", line: 1, text: "@skip" },
    ])
  })
})
