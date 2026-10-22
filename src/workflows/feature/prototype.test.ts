import { describe, expect, it } from "vitest"
import { reportOf } from "./prototype.js"

describe("reportOf", () => {
  it("reads each criterion and problem chunk with its verdict, any case", () => {
    expect(
      reportOf(
        "# Prototype test\n\n## AC-1: pass\n\nok\n\n## AC-2 : FAIL\n\n## Problem double replies: blocked\n",
      ),
    ).toEqual({
      unguided: false,
      items: [
        { subject: "AC-1", verdict: "pass" },
        { subject: "AC-2", verdict: "fail" },
        { subject: "Problem double replies", verdict: "blocked" },
      ],
      malformed: [],
    })
  })

  it("skips fenced lines, deeper headings and prose headings", () => {
    expect(reportOf("```md\n## AC-1: fail\n```\n### AC-2: fail\n## Notes\n")).toEqual({
      unguided: false,
      items: [],
      malformed: [],
    })
  })

  it("lists an item-like heading that misses the shape", () => {
    expect(
      reportOf("## Problem crash — fail\n## AC-2: failed\n## Problems: fail\n## AC-3: maybe\n")
        .malformed,
    ).toEqual(["Problem crash — fail", "AC-2: failed", "Problems: fail", "AC-3: maybe"])
  })

  it("upper-cases a criterion ID written in lower case", () => {
    expect(reportOf("## ac-1: pass\n").items).toEqual([{ subject: "AC-1", verdict: "pass" }])
  })

  it("reads the no-instructions chunk", () => {
    expect(reportOf("## No testing instructions\n\nNo skill found.\n").unguided).toBe(true)
  })
})
