import { describe, expect, it } from "vitest"
import { formatFinding, listFormat, sectionFormat } from "./index.js"
import { formatFromSpec, steeringFormatFor } from "./internal.js"

const criteria = listFormat({
  name: "criteria",
  section: { title: /^acceptance criteria$/i, example: "Acceptance criteria", level: 2 },
  item: { id: /^AC-\d+$/, separator: ":", example: "AC-1" },
  ids: { unique: true },
})

const doc = (...lines: string[]): string => `${lines.join("\n")}\n`

const problems = (format: { validate: (c: string) => readonly unknown[] }, content: string) =>
  format.validate(content).map((f) => formatFinding("F.md", f as never))

describe("listFormat", () => {
  it("parses ID'd items, joining indented continuation lines", () => {
    const parsed = criteria.parse(
      doc(
        "# Plan",
        "",
        "## Acceptance criteria",
        "",
        "- AC-1: first",
        "  wrapped",
        "- AC-2: second",
        "",
        "## Next",
        "",
        "- not read",
      ),
    )
    expect(parsed.problems).toEqual([])
    expect(parsed.items).toEqual([
      { line: 4, id: "AC-1", text: "first wrapped" },
      { line: 6, id: "AC-2", text: "second" },
    ])
  })

  it("validates its own sample, and describes itself", () => {
    expect(criteria.validate(criteria.sample)).toEqual([])
    expect(criteria.sample).toBe("## Acceptance criteria\n\n- AC-1: Describe the item.\n")
    expect(criteria.instructions).toContain("`## Acceptance criteria`")
    expect(criteria.instructions).toContain("`AC-1`")
  })

  it("reports a missing, repeated or misleveled section", () => {
    expect(problems(criteria, doc("# Plan"))).toEqual([
      "missing the `## Acceptance criteria` section",
    ])
    expect(problems(criteria, doc("### Acceptance criteria", "", "- AC-1: a"))).toEqual([
      'F.md:1: "Acceptance criteria" is a level-3 heading — write it as `## Acceptance criteria`',
    ])
    expect(
      problems(
        criteria,
        doc("## Acceptance criteria", "", "- AC-1: a", "", "## Acceptance criteria"),
      ),
    ).toEqual(['F.md:5: "Acceptance criteria" repeats the section on line 1 — keep one'])
  })

  it("reports markers it does not allow, and mixed markers", () => {
    const numbered = listFormat({ name: "steps", markers: ["-", "1."] })
    expect(problems(criteria, doc("## Acceptance criteria", "", "* AC-1: a"))).toEqual([
      "F.md:3: `*` is not an allowed marker — use `-`",
    ])
    expect(problems(numbered, doc("- a", "1. b"))).toEqual([
      "F.md:2: `1.` mixes markers in one list — the list started with `-`",
    ])
  })

  it("reads a numbered list it allows rather than parsing it as empty", () => {
    const numbered = listFormat({ name: "signals", markers: ["1."] })
    expect(numbered.parse(doc("1. a", "2. b")).items.map((i) => i.text)).toEqual(["a", "b"])
  })

  it("reports an unindented continuation line", () => {
    expect(problems(criteria, doc("## Acceptance criteria", "", "- AC-1: a", "b"))).toEqual([
      "F.md:4: continuation line is not indented — indent it under its item, or separate it with a blank line",
    ])
  })

  it("never reads a fenced item, and reports an unclosed fence", () => {
    const parsed = criteria.parse(
      doc("## Acceptance criteria", "", "- AC-1: a", "", "```", "- AC-2: b", "```"),
    )
    expect(parsed.items.map((i) => i.id)).toEqual(["AC-1"])
    expect(parsed.problems.map((p) => p.message)).toContain(
      "a list item inside a code fence is not read as an item",
    )
    expect(
      problems(criteria, doc("## Acceptance criteria", "", "- AC-1: a", "", "```", "x")),
    ).toEqual(["F.md:5: code fence is never closed"])
  })

  it("keeps a fence indented under its item as part of the item", () => {
    expect(
      problems(
        criteria,
        doc("## Acceptance criteria", "", "- AC-1: a", "", "  ```", "  - x", "  ```", "- AC-2: b"),
      ),
    ).toEqual([])
  })

  it("reports duplicate and missing IDs, and empty items", () => {
    expect(
      problems(
        criteria,
        doc("## Acceptance criteria", "", "- AC-1: a", "- AC-1: b", "- c", "- AC-3:"),
      ),
    ).toEqual([
      "F.md:4: duplicate ID AC-1 — first on line 3",
      "F.md:5: item has no ID — start it `AC-1: …`",
      "F.md:6: empty item — AC-3 has no text",
    ])
    expect(problems(listFormat({ name: "plain" }), doc("- a", "-"))).toEqual(["F.md:2: empty item"])
  })

  it("reports text between items and nesting", () => {
    expect(
      problems(
        criteria,
        doc(
          "## Acceptance criteria",
          "",
          "- AC-1: a",
          "",
          "Aside.",
          "",
          "- AC-2: b",
          "  - AC-3: c",
        ),
      ),
    ).toEqual([
      "F.md:5: text between items — make it part of an item, or move it out of the list",
      "F.md:8: nested list — this format is flat, one level of items",
    ])
  })

  it("forbids, strips or requires checkboxes", () => {
    expect(problems(criteria, doc("## Acceptance criteria", "", "- [ ] AC-1: a"))).toEqual([
      "F.md:3: no checkboxes in this list — drop the `[ ]`",
    ])
    const todo = listFormat({ name: "todo", checkbox: "require" })
    expect(todo.parse(doc("- [x] a")).items).toEqual([{ line: 0, text: "a", checked: true }])
    expect(problems(todo, doc("- a"))).toEqual([
      "F.md:1: every item starts with a checkbox — write `- [ ] …`",
    ])
    const stripped = listFormat({ name: "stripped", checkbox: "strip" })
    expect(stripped.parse(doc("- [ ] a", "- b")).items.map((i) => i.checked)).toEqual([
      false,
      false,
    ])
  })

  it("forbids wrapping when told to", () => {
    const flat = listFormat({ name: "flat", wrap: "forbid" })
    expect(problems(flat, doc("- a", "  b"))).toEqual([
      "F.md:2: one line per item — this line continues the one above",
    ])
  })

  it("refuses an inconsistent declaration", () => {
    expect(() => listFormat({ name: "Bad Name" })).toThrow("format name")
    expect(() =>
      listFormat({ name: "x", item: { id: /^A\d$/, separator: ":", example: "B1" } }),
    ).toThrow("does not match")
    expect(() => listFormat({ name: "x", section: { title: /a/, level: 2 } })).toThrow("example")
  })
})

describe("sectionFormat", () => {
  const findings = sectionFormat({ name: "notes", level: 2, title: "unique" })

  it("parses sections with their bodies", () => {
    expect(
      findings.parse(doc("# T", "", "## A", "", "one", "### deeper", "## B")).sections,
    ).toEqual([
      { line: 2, title: "A", body: "one\n### deeper" },
      { line: 6, title: "B", body: "" },
    ])
    expect(findings.validate(findings.sample)).toEqual([])
  })

  it("reports repeated titles, a shallower heading, and a heading in an unclosed fence", () => {
    expect(problems(findings, doc("## A", "## a", "# Up", "```", "## C"))).toEqual([
      'F.md:2: "a" repeats the section on line 1 — titles are unique',
      'F.md:3: "Up" is a level-1 heading — sections are `##`',
      "F.md:4: code fence is never closed",
    ])
  })
})

describe("formatFromSpec", () => {
  it("rebuilds the same format from its spec, RegExps included", () => {
    const rebuilt = formatFromSpec(criteria.spec)
    const content = doc("## Acceptance criteria", "", "- AC-1: a", "- AC-1: b", "* x")
    expect(rebuilt.name).toBe("criteria")
    expect(rebuilt.validate(content)).toEqual(criteria.validate(content))
    const notes = sectionFormat({ name: "notes", level: 2, title: "unique" })
    expect(formatFromSpec(notes.spec).validate("## A\n## A\n")).toEqual(
      notes.validate("## A\n## A\n"),
    )
  })

  it("throws on a spec no declaration produces", () => {
    expect(() => formatFromSpec('{"kind":"nope"}')).toThrow("not a declared format spec")
  })
})

describe("the built-in formats", () => {
  it("are not declared formats — none of these rules apply to them", () => {
    expect(
      steeringFormatFor("findings")!.validate("## A\n\n- [ ] fix\n\n## A\n\n- [ ] fix\n"),
    ).toEqual([])
  })
})
