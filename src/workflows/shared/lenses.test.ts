import { afterEach, describe, expect, it } from "vitest"
import { installContext } from "../../flows/index.js"
import { headingSectionBodies } from "../../steering/index.js"
import { findingsOf } from "./lenses.js"
import { fixtureContext } from "./text.fixture.js"

afterEach(() => installContext(undefined))

const parse = (text: string) => {
  installContext(fixtureContext({}, { sectionBodies: (t) => headingSectionBodies(t) }))
  return findingsOf(text)
}

describe("findingsOf", () => {
  it("numbers one finding per ## chunk, the heading cut from its body", () => {
    expect(parse("# Quality\n\n## a\n\nfix a\n\n## b\n\nfix b\n")).toEqual([
      { id: "Q1", title: "a", body: "fix a" },
      { id: "Q2", title: "b", body: "fix b" },
    ])
  })

  it("keeps prose outside every chunk as a finding of its own", () => {
    expect(parse("# Quality\n\n- stray\n\n## a\n\nfix a\n")).toEqual([
      { id: "Q1", title: "Quality findings", body: "- stray" },
      { id: "Q2", title: "a", body: "fix a" },
    ])
  })

  it("keeps prose a later lens wrote under a # heading after the chunks", () => {
    expect(parse("## a\n\nfix a\n\n# Conventions\n\n- naming off\n")).toEqual([
      { id: "Q1", title: "Quality findings", body: "- naming off" },
      { id: "Q2", title: "a", body: "fix a" },
    ])
  })

  it("reads a file with only a title as no finding", () => {
    expect(parse("# Quality\n")).toEqual([])
  })
})
