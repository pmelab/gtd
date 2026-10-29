import { describe, expect, it } from "vitest"
import { releaseFlagOf } from "./release-flag.js"

const requirements = (section: string): string =>
  `# Requirements\n\n## Impact\n\n- a module\n\n${section}## Acceptance Criteria\n\n- AC-1: a\n`

describe("releaseFlagOf", () => {
  it("asks for no flag without the section, or with none", () => {
    expect(releaseFlagOf(requirements(""))).toEqual({ kind: "none" })
    expect(releaseFlagOf(requirements("## Release Flag\n\nnone\n\n"))).toEqual({ kind: "none" })
  })

  it("reads new and an existing flag's name, backticked or not", () => {
    expect(releaseFlagOf(requirements("## Release Flag\n\nnew\n\n"))).toEqual({ kind: "new" })
    for (const line of [
      "existing: GTD_FLAG_BETA",
      "existing: `GTD_FLAG_BETA`",
      "Existing:GTD_FLAG_BETA",
    ])
      expect(releaseFlagOf(requirements(`## Release Flag\n\n${line}\n\n`))).toEqual({
        kind: "existing",
        name: "GTD_FLAG_BETA",
      })
  })

  it("reads only the first line under the heading, and only a level-2 heading", () => {
    expect(
      releaseFlagOf(requirements("## Release Flag\n\nnew\n\nbecause the sketch says so\n\n")),
    ).toEqual({
      kind: "new",
    })
    expect(releaseFlagOf(requirements("### Release Flag\n\nnew\n\n"))).toEqual({ kind: "none" })
  })

  it("ignores a fenced heading", () => {
    expect(releaseFlagOf(requirements("```\n## Release Flag\n\nnew\n```\n\n"))).toEqual({
      kind: "none",
    })
  })

  it("names the line it cannot read", () => {
    expect(releaseFlagOf(requirements("## Release Flag\n\nmaybe later\n\n"))).toEqual({
      unreadable: "maybe later",
    })
    expect(releaseFlagOf(requirements("## Release Flag\n\nexisting:\n\n"))).toEqual({
      unreadable: "existing:",
    })
  })
})
