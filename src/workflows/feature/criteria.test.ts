import { describe, expect, it } from "vitest"
import type { Change } from "../../flows/index.js"
import { criteriaOf, criterionIds, statedCriteria } from "./criteria.js"

const added = (path: string, after: string): Change => ({
  path,
  status: "added",
  before: undefined,
  after,
})

describe("criteriaOf", () => {
  it("reads ID'd items, joining wrapped lines, and stops at the next section", () => {
    expect(
      criteriaOf(
        "# R\n\n## Acceptance Criteria\n\n- AC-1: one\n  continued\n- two\n\n## Notes\n\n- AC-9: not one\n",
      ),
    ).toEqual([
      { id: "AC-1", text: "one continued" },
      { id: "", text: "two" },
    ])
  })

  it("skips fenced lines, reads an indented item, and stops at a subheading", () => {
    expect(
      criteriaOf(
        "## Acceptance Criteria\n\n- AC-1: runs\n\n```sh\n# setup\n- key: v\n```\n - AC-2: two\n\n### Notes\n\n- note\n",
      ),
    ).toEqual([
      { id: "AC-1", text: "runs" },
      { id: "AC-2", text: "two" },
    ])
  })

  it("reads only the level-2 section and joins an unindented wrapped line", () => {
    expect(
      criteriaOf(
        "### Acceptance criteria\n\n- x\n\n## Acceptance Criteria\n\n- AC-1: exits 2 when the config\nfile is missing\n",
      ),
    ).toEqual([{ id: "AC-1", text: "exits 2 when the config file is missing" }])
  })

  it("folds a nested sub-bullet into its criterion", () => {
    expect(
      criteriaOf(
        "## Acceptance Criteria\n\n- AC-1: exits 2 when config is bad\n  - missing file\n",
      ),
    ).toEqual([{ id: "AC-1", text: "exits 2 when config is bad - missing file" }])
  })

  it("is undefined without the section", () => {
    expect(criteriaOf("# R\n\n- AC-1: x\n")).toBeUndefined()
  })
})

describe("statedCriteria", () => {
  it("numbers a stated checklist from AC-1", () => {
    const sketch = [added("TODO.md", "# T\n\n### Acceptance criteria:\n\n- [ ] a\n* b\n\nprose\n")]
    expect(statedCriteria(sketch, "abc")).toMatchObject({
      path: "TODO.md",
      commit: "abc",
      criteria: [
        { id: "AC-1", text: "a" },
        { id: "AC-2", text: "b" },
      ],
    })
  })

  it("renumbers when the stated IDs are partial or clash", () => {
    const sketch = [added("TODO.md", "## Acceptance criteria\n\n- AC-4: a\n- b\n")]
    expect(statedCriteria(sketch, "abc")?.criteria).toEqual([
      { id: "AC-1", text: "a" },
      { id: "AC-2", text: "b" },
    ])
  })

  it("ignores a list the sketch left unchanged, a file other than TODO.md, a sketch with more in it, and an ambiguous pair", () => {
    const list = "## Acceptance criteria\n\n- a\n"
    expect(
      statedCriteria(
        [{ path: "TODO.md", status: "modified", before: list, after: `${list}\nmore\n` }],
        "abc",
      ),
    ).toBeUndefined()
    expect(
      statedCriteria(
        [
          {
            path: "TODO.md",
            status: "modified",
            before: `${list}- \n`,
            after: `${list}- \n\nmore\n`,
          },
        ],
        "abc",
      ),
    ).toBeUndefined()
    expect(statedCriteria([added("docs/guide.md", list)], "abc")).toBeUndefined()
    expect(
      statedCriteria([added("TODO.md", list), added("src/a.ts", "x\n")], "abc"),
    ).toBeUndefined()
    expect(
      statedCriteria([added("TODO.md", list), added(".gtd/TODO.md", list)], "abc"),
    ).toBeUndefined()
  })
})

describe("criterionIds", () => {
  const requirements = "## Acceptance Criteria\n\n- AC-1: a\n- AC-2: b\n- AC-4: added\n- unnamed\n"

  it("lists every ID'd criterion of an unsliced change", () => {
    expect(criterionIds(requirements)).toEqual(["AC-1", "AC-2", "AC-4"])
  })

  it("keeps `only` to the IDs the file still lists", () => {
    expect(criterionIds(requirements, { only: ["AC-1", "AC-3"] })).toEqual(["AC-1"])
  })

  it("gives `except` every other ID, one added since included", () => {
    expect(criterionIds(requirements, { except: ["AC-1", "AC-3"] })).toEqual(["AC-2", "AC-4"])
  })
})
