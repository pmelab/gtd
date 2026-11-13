import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { serialize } from "./Serialize.js"
import { parseWidgets } from "./index.js"

const lines = (...ls: string[]): string => `${ls.join("\n")}\n`
const long = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(" ")

const fixtureDir = new URL("./fixtures/", import.meta.url).pathname
const fixtures = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return fixtures(path)
    return name.endsWith(".md") ? [path] : []
  })

describe("serialize", () => {
  it("refills a paragraph to 80 columns", () => {
    expect(serialize(lines(long(20)))).toBe(
      lines(
        "word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
        "word13 word14 word15 word16 word17 word18 word19",
      ),
    )
  })

  it("joins short lines of one paragraph", () => {
    expect(serialize(lines("one", "two", "three"))).toBe(lines("one two three"))
  })

  it("hangs a task item's continuation under its text", () => {
    expect(serialize(lines(`- [ ] ${long(16)}`))).toBe(
      lines(
        "- [ ] word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11",
        "      word12 word13 word14 word15",
      ),
    )
  })

  it("hangs a task item that opens with inline code", () => {
    expect(serialize(lines(`- [x] \`code\` ${long(15)}`))).toBe(
      lines(
        "- [x] `code` word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10",
        "      word11 word12 word13 word14",
      ),
    )
  })

  it("never breaks inside inline code, a link or a footnote marker", () => {
    const text = `${"x".repeat(60)} \`a b c d e f g h i\` [a link text](https://example.com/a) end[^1]`
    expect(serialize(lines(text, "", "[^1]: Note."))).toBe(
      lines(
        `${"x".repeat(60)} \`a b c d e f g h i\``,
        "[a link text](https://example.com/a) end[^1]",
        "",
        "[^1]: Note.",
      ),
    )
  })

  it("collapses a newline inside an atomic node", () => {
    expect(serialize(lines("see [the", "docs](./d.md) now"))).toBe(
      lines("see [the docs](./d.md) now"),
    )
  })

  it("keeps a word that would start a block on the line before", () => {
    const text = `${"x".repeat(77)} - y`
    expect(serialize(lines(text))).toBe(lines(`${"x".repeat(77)} -`, "y"))
  })

  it("leaves headings, code, quotes, tables and hard breaks as written", () => {
    const content = lines(
      `## ${long(20)}`,
      "",
      "```",
      long(20),
      "```",
      "",
      `> ${long(20)}`,
      "",
      `| a | ${long(20)} |`,
      "|---|---|",
      "",
      "one  ",
      "two",
    )
    expect(serialize(content)).toBe(content)
  })

  it("never breaks a hunk pointer", () => {
    const pointer = `./src/${"deep/".repeat(15)}file.ts#10-20`
    expect(serialize(lines(`- [ ] ${pointer} — note`))).toBe(
      lines(`- [ ] ${pointer}`, "      — note"),
    )
  })

  it("ends with exactly one newline and keeps CRLF", () => {
    expect(serialize("a\n\n\n")).toBe("a\n")
    expect(serialize("a\r\nb\r\n\r\nc")).toBe("a b\r\n\r\nc\r\n")
  })

  it.each(fixtures(fixtureDir))("is idempotent and keeps the widgets of %s", (path) => {
    const content = readFileSync(path, "utf8")
    const once = serialize(content)
    expect(serialize(once)).toBe(once)
    const strip = (c: string) =>
      JSON.stringify(parseWidgets(c).widgets, (key, value: unknown) =>
        key === "line" || key === "endLine"
          ? undefined
          : typeof value === "string"
            ? value.replace(/\s+/g, " ")
            : value,
      )
    expect(strip(once)).toBe(strip(content))
  })

  it("leaves the reference plan as written", () => {
    const plan = readFileSync(join(fixtureDir, "widgets/plan.md"), "utf8")
    expect(serialize(plan)).toBe(plan)
  })
})
