import { describe, expect, it } from "vitest"
import { runsItsScript, testRepo, type TestRepo } from "../../testkit/index.js"
import { CONFIG_SCAFFOLD } from "../../install/index.js"
import { reviewDoc } from "../shared/config.fixture.js"
import { base } from "./review.js"

const REVIEW = ".gtd/REVIEW.md"
const ORIG = ".gtd/REVIEW.orig.md"

/** A repository with one commit to review, the review run until the human holds `.gtd/REVIEW.md`. */
const reviewed = async (): Promise<TestRepo> => {
  const repo = testRepo({ workflow: CONFIG_SCAFFOLD, env: { GTD_QUALITYREVIEWS: "" } })
  repo.write("src/calc.ts", "export const add = (a: number, b: number) => a + b\n")
  repo.commit("feat: add calculator")
  await repo.door("review", "HEAD~1")
  const rest = await repo.drive({
    "review-gate.check": () => undefined,
    "build.health.check": () => undefined,
    "build.review.reviewing": (beat, r) => {
      expect(beat.file).toBe(REVIEW)
      r.write(REVIEW, reviewDoc("new add function"))
    },
  })
  expect(rest).toMatchObject({ state: "build.review.await-review", actor: "human" })
  return repo
}

describe("the review workflow", () => {
  it("checks, reviews and hands the review to the human", async () => {
    const repo = await reviewed()
    expect(repo.subjects().slice(2)).toEqual([
      "gtd(human): review-gate.check",
      "gtd(check): review-gate.check → build.health.check",
      "gtd(check): build.health.check → build.review.reviewing",
      "gtd(agent): build.review.reviewing → build.review.await-review",
    ])
  })

  it("closes a review the human signs off", async () => {
    const repo = await reviewed()
    repo.write(REVIEW, reviewDoc("new add function").replace("- [ ]", "- [x]"))
    await repo.land()
    const rest = await repo.drive({ "build.review.closing": runsItsScript })
    expect(rest.state).toBe("idle")
    expect(repo.subjects().slice(-2)).toEqual([
      "gtd(human): build.review.await-review → build.review.closing",
      "gtd(check): build.review.closing → idle",
    ])
    expect(repo.read(REVIEW)).toBeUndefined()
  })

  it("never lands a review the review format rejects", async () => {
    const repo = testRepo({ workflow: CONFIG_SCAFFOLD, env: { GTD_QUALITYREVIEWS: "" } })
    repo.write("src/calc.ts", "export const add = (a: number, b: number) => a + b\n")
    repo.commit("feat: add calculator")
    await repo.door("review", "HEAD~1")
    await expect(
      repo.drive({
        "review-gate.check": () => undefined,
        "build.health.check": () => undefined,
        "build.review.reviewing": (_, r) => r.write(REVIEW, "not a review\n"),
      }),
    ).rejects.toThrow(/validating \.gtd\/REVIEW\.md/)
    expect(repo.subjects().at(-1)).toBe("gtd(check): build.health.check → build.review.reviewing")
  })

  it("ends with the review and the reviewer's copy kept when the human leaves a note", async () => {
    const repo = await reviewed()
    repo.write(REVIEW, reviewDoc("new add function — rename it to sum"))
    await repo.land()
    const rest = await repo.drive({
      "build.review.handing-off": runsItsScript,
    })
    expect(rest.state).toBe("idle")
    expect(repo.subjects().slice(-2)).toEqual([
      "gtd(human): build.review.await-review → build.review.handing-off",
      "gtd(check): build.review.handing-off → idle",
    ])
    expect(repo.read(REVIEW)).toContain("rename it to sum")
    expect(repo.read(ORIG)).toBe(reviewDoc("new add function"))
  })

  it("refuses a pending hand-off before requesting any step, the gate's check included", async () => {
    const repo = testRepo({
      workflow: CONFIG_SCAFFOLD,
      files: { [REVIEW]: reviewDoc("note"), [ORIG]: reviewDoc("orig") },
    })
    await expect(repo.door("review")).rejects.toThrow(".gtd/REVIEW.orig.md is a pending hand-off")
    expect(repo.subjects()).toEqual(["chore: initial commit"])
  })
})

describe("the deprecated shipped base", () => {
  it("answers for a workflow named review only, mapping reviewBase", () => {
    expect(base("review", {})).toBe("")
    expect(base("review", { reviewBase: "v1" })).toBe("v1")
    expect(base("audit", { reviewBase: "v1" })).toBeUndefined()
  })
})
