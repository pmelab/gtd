import { describe, expect, it } from "vitest"
import { runsItsScript, testRepo } from "../../testkit/index.js"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { reviewDoc } from "../shared/config.fixture.js"

const REVIEW = ".gtd/REVIEW.md"
const ORIG = ".gtd/REVIEW.orig.md"
const CALC = "export const add = (a: number, b: number) => a + b\n"

describe("the fix workflow", () => {
  it("with no handed-off review, repairs a red baseline and hands it to review", async () => {
    const repo = testRepo({ workflow: CONFIG_SCAFFOLD, env: { GTD_QUALITYREVIEWS: "" } })
    await repo.start("fix")
    const rest = await repo.drive({
      "fix-precheck": (_, r) => r.write(".gtd/FEEDBACK.md", "1 test failing\n"),
      "build.fix": (beat, r) => {
        expect(beat.content).toContain(".gtd/FEEDBACK.md")
        r.remove(".gtd/FEEDBACK.md")
        r.write("src/repair.ts", "export const repaired = true\n")
      },
      "build.health.check": () => undefined,
    })
    expect(rest).toMatchObject({ state: "build.review.reviewing", actor: "agent" })
    expect(repo.subjects().slice(1)).toEqual([
      "gtd(human): fix-precheck",
      "gtd(check): fix-precheck → build.fix",
      "gtd(agent): build.fix → build.health.check",
      "gtd(check): build.health.check → build.review.reviewing",
    ])
  })

  it("with a green baseline, has nothing to fix", async () => {
    const repo = testRepo({ workflow: CONFIG_SCAFFOLD, env: { GTD_QUALITYREVIEWS: "" } })
    await repo.start("fix")
    const rest = await repo.drive({ "fix-precheck": () => undefined })
    expect(rest.state).toBe("idle")
    expect(repo.subjects().at(-1)).toBe("gtd(check): fix-precheck → idle")
  })

  it("fixes a handed-off review's notes and risks in one turn, removes both review files, then checks health", async () => {
    const repo = testRepo({
      workflow: CONFIG_SCAFFOLD,
      env: { GTD_QUALITYREVIEWS: "" },
      files: {
        "src/calc.ts": CALC,
        [REVIEW]: reviewDoc("add — rename it to sum", "Risk: drops the carry"),
        [ORIG]: reviewDoc("add", "Risk: drops the carry"),
      },
    })
    await repo.door("fix")
    const rest = await repo.drive({
      "notes.fixing": (beat, r) => {
        expect(beat.content).toContain("rename it to sum")
        expect(beat.content).toContain("Risk: drops the carry")
        r.write("src/calc.ts", CALC.replace("add", "sum"))
      },
      "notes.closing": runsItsScript,
    })
    expect(rest.state).toBe("build.health.check")
    expect(repo.subjects().slice(1)).toEqual([
      "gtd(human): notes.fixing",
      "gtd(agent): notes.fixing → notes.closing",
      "gtd(check): notes.closing → build.health.check",
    ])
    expect(repo.read("src/calc.ts")).toContain("sum")
    expect(repo.read(REVIEW)).toBeUndefined()
    expect(repo.read(ORIG)).toBeUndefined()
  })

  it("refuses a review with no reviewer's copy, so no note is deleted unread", async () => {
    const repo = testRepo({ workflow: CONFIG_SCAFFOLD, files: { [REVIEW]: reviewDoc("add") } })
    await expect(repo.door("fix")).rejects.toThrow(/not handed off/)
  })
})
