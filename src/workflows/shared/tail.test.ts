import { afterEach, describe, expect, it } from "vitest"
import {
  installContext,
  type Change,
  type CodeThreadInfo,
  type StepRequest,
} from "../../flows/index.js"
import type { Guard } from "./health.js"
import { handOffReview, qualityLap, REVIEW_ORIG, tail } from "./tail.js"
import { fixtureContext } from "./text.fixture.js"

afterEach(() => installContext(undefined))

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
  extra: {
    paths?: readonly string[]
    codeThreads?: readonly CodeThreadInfo[]
    guard?: Guard
  } = {},
) => {
  const log: string[] = []
  const gates: boolean[] = []
  const scripts = new Map<string, string>()
  const files = new Map<string, string>()
  const onReviewing = () => {
    if (log.filter((n) => n === "review.reviewing").length > 1) throw new Error("re-review")
    if (after !== "unwritten") files.set(REVIEW, reviewDoc("new add function"))
  }
  const onGate = (request: StepRequest) => {
    if (request.kind === "human") gates.push(request.options.acceptClean === true)
    if (after === "deleted") files.delete(REVIEW)
    else if (after !== "unwritten") files.set(REVIEW, after)
  }
  installContext(
    fixtureContext(
      { codeThreads: extra.codeThreads ?? [] },
      {
        step: (request: StepRequest) => {
          if (request.kind === "restart") return Promise.resolve()
          log.push(request.name)
          if (request.kind === "run") scripts.set(request.name, request.body)
          if (request.name === "review.reviewing") onReviewing()
          if (request.name === "review.await-review") onGate(request)
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
  const refusal = await handOffReview("base", { rounds: 0 }, extra.guard).then(
    () => undefined,
    (e: unknown) => (e as Error).message,
  )
  return { log, scripts, refusal, gates }
}

describe("the hand-off review", () => {
  it("no note signs off and closes the review", async () => {
    const run = await handOff(reviewDoc("new add function"))
    expect(run.log).toEqual(["review.reviewing", "review.await-review", "review.closing"])
  })

  it("the review gate accepts a clean landing", async () => {
    const run = await handOff(reviewDoc("new add function"))
    expect(run.gates).toEqual([true])
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

  describe("guard", () => {
    it("runs after the reviewing turn and never after the human's await-review landing", async () => {
      const seen: string[] = []
      const run = await handOff(reviewDoc("new add function"), {
        guard: () => seen.push("guard"),
      })
      expect(run.log).toEqual(["review.reviewing", "review.await-review", "review.closing"])
      expect(seen).toEqual(["guard"])
    })

    it("a refusal after reviewing stops the round before the human gate", async () => {
      const run = await handOff(reviewDoc("new add function"), {
        guard: () => {
          throw new Error("guarded: nope")
        },
      })
      expect(run.refusal).toBe("guarded: nope")
      expect(run.log).toEqual(["review.reviewing"])
    })

    it("does not run after review-missing", async () => {
      let calls = 0
      const run = await handOff("unwritten", { guard: () => void calls++ })
      expect(run.log).toContain("review.review-missing")
      // the fixture aborts the second reviewing turn: only the first was guarded
      expect(calls).toBe(1)
    })
  })
})

const prompts: string[] = []
const models: (string | undefined)[] = []

describe("the quality lap's lenses", () => {
  const lap = async (run: () => Promise<unknown>, vars: Record<string, string> = {}) => {
    const log: string[] = []
    prompts.length = 0
    models.length = 0
    installContext(
      fixtureContext(
        { vars },
        {
          step: (request: StepRequest) => {
            if (request.kind !== "restart") log.push(request.name)
            if (request.kind === "agent") {
              prompts.push(request.prompt)
              models.push(request.options.model)
            }
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          start: () => "START-SHA",
        },
      ),
    )
    await run()
    return log
  }

  it("default to the qualityReviews setting", async () => {
    const log = await lap(() => qualityLap(), { qualityReviews: "correctness, conventions" })
    expect(log).toEqual(["quality.correctness.reviewing", "quality.conventions.reviewing"])
  })

  it("lenses override qualityReviews", async () => {
    const log = await lap(() => qualityLap(undefined, ["ponytail-review"]), {
      qualityReviews: "correctness, conventions",
    })
    expect(log).toEqual(["quality.ponytail-review.reviewing"])
  })

  it("an empty list runs no lens turn", async () => {
    const log = await lap(() => qualityLap(undefined, []), { qualityReviews: "correctness" })
    expect(log).toEqual([])
  })

  it("lensBase reaches every lens turn's prompt; absent, they name start()", async () => {
    await lap(() => qualityLap(undefined, ["conventions", "correctness"], "BASE-SHA"))
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).toContain("from `BASE-SHA`")
    await lap(() => qualityLap(undefined, ["conventions", "correctness"]))
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).toContain("from `START-SHA`")
  })

  it("tail threads lensBase to every lens turn", async () => {
    await lap(() =>
      tail(() => Promise.resolve(), {
        green: true,
        lenses: ["conventions", "correctness"],
        lensBase: "BASE-SHA",
      }),
    )
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).toContain("from `BASE-SHA`")
  })

  it("the deprecated form threads lensBase from its seventh slot", async () => {
    await lap(() =>
      tail(false, () => Promise.resolve(), true, undefined, ["conventions"], true, "BASE-SHA", "R"),
    )
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("from `BASE-SHA`")
    expect(prompts[0]).not.toContain("from `R`")
  })

  it("each lens runs on its qualityReviews hint, else its default", async () => {
    await lap(() => qualityLap(), { qualityReviews: "correctness=base, conventions, my-lens" })
    expect(models).toEqual(["base", "base", "smart"])
  })

  it("tail's lensModels replace the qualityReviews hints", async () => {
    await lap(
      () =>
        tail(() => Promise.resolve(), {
          green: true,
          lenses: ["correctness", "conventions"],
          lensModels: { conventions: "opus" },
        }),
      { qualityReviews: "correctness=base" },
    )
    expect(models).toEqual(["smart", "opus"])
  })

  it("tail passes lenses to its lap and a guard after each lens turn", async () => {
    let guards = 0
    const log = await lap(() =>
      tail(() => Promise.resolve(), {
        green: true,
        guard: () => void guards++,
        lenses: ["conventions"],
      }),
    )
    expect(log).toEqual(["quality.conventions.reviewing"])
    expect(guards).toBe(1)
  })
})

describe("tail's call forms", () => {
  class Stop extends Error {}
  const requestNames = async (
    call: () => Promise<unknown>,
    names: string[] = [],
  ): Promise<string[]> => {
    installContext(
      fixtureContext(
        { vars: { qualityReviews: "correctness" } },
        {
          step: (request: StepRequest) => {
            if (request.kind === "restart") return Promise.resolve()
            names.push(`${request.kind}:${request.name}`)
            if (request.kind === "agent") prompts.push(request.prompt)
            if (names.length >= 4) throw new Stop()
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          start: () => "START-SHA",
        },
      ),
    )
    await call().catch((error: unknown) => {
      if (!(error instanceof Stop)) throw error
    })
    return names
  }
  const finish = () => Promise.resolve()

  for (const [fixFirst, green] of [
    [true, false],
    [true, true],
    [false, true],
    [false, false],
  ] as const) {
    it(`the deprecated positional form matches the options form for fixFirst ${fixFirst}, green ${green}`, async () => {
      const modern = await requestNames(() => tail(finish, { fixFirst, green }))
      const legacy = await requestNames(() => tail(fixFirst, finish, green))
      expect(legacy).toEqual(modern)
    })
  }

  it("the deprecated form passes every positional on", async () => {
    let guards = 0
    const guard = () => void guards++
    const modern = await requestNames(() =>
      tail(finish, { green: true, guard, lenses: ["conventions"], guardRests: false }),
    )
    const modernGuards = guards
    guards = 0
    const legacy = await requestNames(() =>
      tail(false, finish, true, guard, ["conventions"], false),
    )
    expect(legacy).toEqual(modern)
    expect(guards).toBe(modernGuards)
  })

  it("the deprecated form threads rules from its eighth slot", async () => {
    prompts.length = 0
    await requestNames(() =>
      tail(true, finish, false, undefined, [], true, "BASE-SHA", "RULES-TEXT"),
    )
    expect(prompts.some((p) => p.includes("RULES-TEXT"))).toBe(true)
    expect(prompts.some((p) => p.includes("BASE-SHA"))).toBe(false)
  })

  it("the deprecated form still runs untyped flags as truthy or falsy", async () => {
    expect(await requestNames(() => tail(1 as never, finish, 0 as never))).toEqual(
      await requestNames(() => tail(finish, { fixFirst: true })),
    )
  })

  it("reads an explicit undefined in every option as absent", async () => {
    const absent = await requestNames(() => tail(finish))
    const explicit = await requestNames(() =>
      tail(finish, {
        fixFirst: undefined,
        green: undefined,
        guard: undefined,
        lenses: undefined,
        guardRests: undefined,
        lensBase: undefined,
        rules: undefined,
      }),
    )
    expect(explicit).toEqual(absent)
  })

  const fitsNeither: [string, () => Promise<unknown>][] = [
    ["no finish", () => (tail as (...args: unknown[]) => Promise<unknown>)(false)],
    ["a finish followed by a boolean", () => tail(finish, true as never)],
    ["a finish followed by a function", () => tail(finish, finish as never)],
    ["a finish followed by a Promise", () => tail(finish, Promise.resolve({}) as never)],
    [
      "a finish with a third argument",
      () => (tail as (...args: unknown[]) => Promise<unknown>)(finish, {}, true),
    ],
  ]
  for (const [label, call] of fitsNeither) {
    it(`rejects ${label} before any step runs`, async () => {
      const names: string[] = []
      const rejected = expect(requestNames(call, names)).rejects
      await rejected.toThrow("tail(finish, options?)")
      await rejected.toThrow(
        "tail(fixFirst, finish, green?, guard?, lenses?, guardRests?, lensBase?, rules?)",
      )
      expect(names).toEqual([])
    })
  }
})
