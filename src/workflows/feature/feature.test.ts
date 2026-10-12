import { describe, expect, it } from "vitest"
import { testRepo } from "../../testkit/index.js"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { reviewDoc } from "../shared/config.fixture.js"

describe("an ordinary feature start", () => {
  it("unwinds a captured TODO, checks the baseline and starts design from it", async () => {
    const repo = testRepo({ workflow: CONFIG_SCAFFOLD, env: { GTD_QUALITYREVIEWS: "" } })
    repo.write("TODO.md", "# Add numbers\n\nadd(a, b) returns the sum.\n")
    const rest = await repo.drive({ unwind: () => undefined, "start-gate.check": () => undefined })
    expect(rest).toMatchObject({
      state: "design.triage",
      actor: "agent",
      file: ".gtd/REQUIREMENTS.md",
    })
    expect(repo.subjects().slice(1)).toEqual([
      "gtd(human): idle → unwind",
      "gtd(check): unwind → start-gate.check",
      "gtd(check): start-gate.check → design.triage",
    ])
  })

  it("refuses a pending hand-off right after idle, before unwinding", async () => {
    const repo = testRepo({
      workflow: CONFIG_SCAFFOLD,
      files: { ".gtd/REVIEW.md": reviewDoc("note"), ".gtd/REVIEW.orig.md": reviewDoc("orig") },
    })
    repo.write("TODO.md", "# Add numbers\n")
    await expect(repo.land()).rejects.toThrow(".gtd/REVIEW.orig.md is a pending hand-off")
    expect(repo.subjects()).toEqual(["chore: initial commit"])
  })
})
