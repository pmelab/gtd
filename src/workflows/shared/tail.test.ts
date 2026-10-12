import { afterEach, describe, expect, it } from "vitest"
import {
  installContext,
  type Change,
  type CodeThreadInfo,
  type StepRequest,
} from "../../flows/index.js"
import { fixQualityFindings, handOffReview, REVIEW_ORIG } from "./tail.js"
import { fixtureContext } from "./text.fixture.js"

afterEach(() => installContext(undefined))

describe("the quality fix loop", () => {
  it("a fix that resolves QUALITY.md and rewrites a scenario ends after the wording gate", async () => {
    const QUALITY = ".gtd/QUALITY.md"
    const log: string[] = []
    const files = new Map([
      [QUALITY, "- finding"],
      ["e2e/a.feature", "Given a"],
    ])
    let last: readonly Change[] = []
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            if (request.kind === "restart") return Promise.resolve()
            log.push(request.name)
            last = []
            if (request.name === "fix.quality.fixing") {
              files.delete(QUALITY)
              files.set("e2e/a.feature", "Given b")
              last = [{ path: QUALITY, status: "deleted", before: "- finding", after: undefined }]
            }
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          read: (path) => files.get(path),
          changes: () => last,
          matches: (path, pattern) => path === pattern,
          head: () => "h2",
          start: () => "h0",
        },
      ),
    )
    const frozen = { at: "h1", texts: { "e2e/a.feature": "Given a" } }
    expect(await fixQualityFindings({ rounds: 0 }, frozen)).toBe(true)
    expect(log).toEqual(["fix.quality.fixing", "scenario-wording"])
  })
})

const REVIEW = ".gtd/REVIEW.md"
const reviewDoc = (note: string): string =>
  [
    "# Review: abc1234",
    "",
    "<!-- base: 0000000 -->",
    "",
    "## calc",
    "- [ ] ./src/calc.ts#1",
    note,
    "",
  ].join("\n")

/**
 * Run `handOffReview` with the human leaving `after` at the gate; `"deleted"`
 * has the human delete the review, `"unwritten"` has the reviewer write none.
 * Returns the steps and scripts, and the message of what it threw.
 */
const handOff = async (
  after: string | "deleted" | "unwritten",
  extra: { paths?: readonly string[]; codeThreads?: readonly CodeThreadInfo[] } = {},
) => {
  const log: string[] = []
  const scripts = new Map<string, string>()
  const files = new Map<string, string>()
  installContext(
    fixtureContext(
      { codeThreads: extra.codeThreads ?? [] },
      {
        step: (request: StepRequest) => {
          if (request.kind === "restart") return Promise.resolve()
          log.push(request.name)
          if (request.kind === "run") scripts.set(request.name, request.body)
          if (request.name === "review.reviewing") {
            if (log.filter((n) => n === "review.reviewing").length > 1) throw new Error("re-review")
            if (after !== "unwritten") files.set(REVIEW, reviewDoc("new add function"))
          }
          if (request.name === "review.await-review") {
            if (after === "deleted") files.delete(REVIEW)
            else if (after !== "unwritten") files.set(REVIEW, after)
          }
          return Promise.resolve()
        },
        refuse: (message: string): never => {
          throw new Error(message)
        },
        pushScope: () => undefined,
        popScope: () => undefined,
        read: (path) => files.get(path),
        matches: (path, pattern) => path === pattern,
        changes: (): readonly Change[] =>
          after === "deleted"
            ? [
                {
                  path: REVIEW,
                  status: "deleted",
                  before: reviewDoc("new add function"),
                  after: undefined,
                },
              ]
            : [],
        changesSince: (): readonly Change[] => [
          {
            path: REVIEW,
            status: "modified",
            before: reviewDoc("new add function"),
            after: files.get(REVIEW),
          },
          ...(extra.paths ?? []).map(
            (path): Change => ({ path, status: "modified", before: "a", after: "b" }),
          ),
        ],
        head: () => "c1",
        start: () => "c0",
      },
    ),
  )
  const refusal = await handOffReview("base", { rounds: 0 }).then(
    () => undefined,
    (e: unknown) => (e as Error).message,
  )
  return { log, scripts, refusal }
}

describe("the hand-off review", () => {
  it("no note signs off and closes the review", async () => {
    const run = await handOff(reviewDoc("new add function"))
    expect(run.log).toEqual(["review.reviewing", "review.await-review", "review.closing"])
  })

  it("a note ends the round with the review kept and the reviewer's version copied beside it", async () => {
    const run = await handOff(reviewDoc("new add function — rename it to sum"))
    expect(run.log).toEqual(["review.reviewing", "review.await-review", "review.handing-off"])
    expect(run.scripts.get("review.handing-off")).toContain(
      `git show 'c1:${REVIEW}' > '${REVIEW_ORIG}'`,
    )
  })

  it("an edit that parses to no note (a deleted chunk) is refused, not handed to a fix with nothing to read", async () => {
    const run = await handOff("# Review: abc1234\n\n<!-- base: 0000000 -->\n")
    expect(run.refusal).toMatch(/contains no note fix can read/)
    expect(run.log).toEqual(["review.reviewing", "review.await-review"])
  })

  it("a hand edit in a sign-off round keeps the suite green before closing", async () => {
    const run = await handOff(reviewDoc("new add function"), { paths: ["src/calc.ts"] })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "health.check",
      "review.closing",
    ])
  })

  it("a change under .gtd/ alone does not run the green check", async () => {
    const run = await handOff(reviewDoc("new add function"), { paths: [".gtd/OTHER.md"] })
    expect(run.log).toEqual(["review.reviewing", "review.await-review", "review.closing"])
  })

  it("a code thread waiting on the agent is refused, not signed off", async () => {
    const run = await handOff(reviewDoc("new add function"), {
      codeThreads: [
        { path: "src/calc.ts", line: 1, waitingOn: "agent", first: "why?", faults: [] },
      ],
    })
    expect(run.refusal).toMatch(/nothing answers it here/)
  })

  it("a thread waiting on the human at the gate is refused", async () => {
    const run = await handOff(reviewDoc("new add function"), {
      codeThreads: [
        { path: "src/calc.ts", line: 1, waitingOn: "human", first: "why?", faults: [] },
      ],
    })
    expect(run.refusal).toMatch(/wait on you/)
  })

  it("a round the reviewer left no review for rests at review-missing, then reviews again", async () => {
    const run = await handOff("unwritten")
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.review-missing",
      "review.reviewing",
    ])
  })

  it("a review the human deleted is refused, not re-reviewed", async () => {
    const run = await handOff("deleted")
    expect(run.refusal).toMatch(/was deleted — restore it, or leave a note to hand to fix/)
    expect(run.log).toEqual(["review.reviewing", "review.await-review"])
  })
})
