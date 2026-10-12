import { afterEach, describe, expect, it } from "vitest"
import { installContext, type StepRequest } from "../../flows/index.js"
import { fixtureContext } from "../shared/text.fixture.js"
import { fixFlow } from "./fix.js"

afterEach(() => installContext(undefined))

const REVIEW = ".gtd/REVIEW.md"
const ORIG = ".gtd/REVIEW.orig.md"

const reviewDoc = (...notes: string[]): string =>
  [
    "# Review: abc1234",
    "",
    "<!-- base: 0000000 -->",
    "",
    "## calc",
    ...notes.flatMap((note, i) => [`- [ ] ./src/calc.ts#${i + 1}`, note]),
    "",
  ].join("\n")

class Stop extends Error {}

/** Run `fix` over `files` until its third step; returns the steps it asked for. */
const drive = async (files: Readonly<Record<string, string>>): Promise<StepRequest[]> => {
  const steps: StepRequest[] = []
  installContext(
    fixtureContext(
      {},
      {
        step: (request: StepRequest) => {
          steps.push(request)
          if (steps.length >= 3) throw new Stop()
          return Promise.resolve()
        },
        refuse: (message: string): never => {
          throw new Error(message)
        },
        pushScope: () => undefined,
        popScope: () => undefined,
        // Closing removes both review files, as the real tree would show.
        read: (path) =>
          steps.some((s) => "name" in s && s.name === "closing") ? undefined : files[path],
        head: () => "c1",
        start: () => "c0",
      },
    ),
  )
  await fixFlow().catch((e: unknown) => {
    if (!(e instanceof Stop)) throw e
  })
  return steps
}

describe("the fix workflow", () => {
  it("with no handed-off review, repairs a red baseline from fix-precheck", async () => {
    const [first] = await drive({})
    expect(first).toMatchObject({ kind: "run", name: "fix-precheck" })
  })

  it("fixes a handed-off review's notes and risks in one turn, then removes both review files", async () => {
    const steps = await drive({
      [REVIEW]: reviewDoc("add — rename it to sum", "Risk: drops the carry"),
      [ORIG]: reviewDoc("add", "Risk: drops the carry"),
    })
    const [fixing, closing] = steps
    if (fixing?.kind !== "agent" || closing?.kind !== "run") throw new Error("unexpected steps")
    expect(fixing.name).toBe("fixing")
    expect(fixing.prompt).toContain("rename it to sum")
    expect(fixing.prompt).toContain("Risk: drops the carry")
    expect(closing.name).toBe("closing")
    expect(closing.body).toContain(REVIEW)
    expect(closing.body).toContain(ORIG)
  })

  it("after the notes, checks health before the suite is trusted", async () => {
    const steps = await drive({ [REVIEW]: reviewDoc("add"), [ORIG]: reviewDoc("add") })
    expect(steps.map((s) => [s.kind, "name" in s ? s.name : undefined])).toEqual([
      ["agent", "fixing"],
      ["run", "closing"],
      ["run", "health.check"],
    ])
  })

  it("refuses a reviewer's copy left with no review", async () => {
    await expect(drive({ [ORIG]: reviewDoc("add") })).rejects.toThrow(/has no \.gtd\/REVIEW\.md/)
  })

  it("refuses a review with no reviewer's copy, so no note is deleted unread", async () => {
    await expect(drive({ [REVIEW]: reviewDoc("Risk: drops the carry") })).rejects.toThrow(
      /not handed off/,
    )
  })
})
