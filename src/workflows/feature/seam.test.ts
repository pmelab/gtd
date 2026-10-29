import { afterEach, describe, expect, it } from "vitest"
import {
  installContext,
  type Change,
  type FlowContext,
  type KeptTip,
  type StepRequest,
} from "../../flows/index.js"
import { globMatches } from "../../wire/index.js"
import { fixtureContext } from "../shared/text.fixture.js"
import {
  implement,
  judgeSeam,
  naivePass,
  acceptanceFault,
  naiveAcceptance,
  seamBuild,
  type SeamOutcome,
} from "./seam.js"
import { captureStep } from "../shared/text.fixture.js"

afterEach(() => installContext(undefined))

const change = (path: string, status: Change["status"]): Change => ({
  path,
  status,
  before: status === "added" ? undefined : "a",
  after: status === "deleted" ? undefined : "b",
})

const tip = (...changes: Change[]): KeptTip =>
  ({
    hash: "abc",
    changes: Object.assign([...changes], { paths: [], get: () => undefined }),
  }) as KeptTip

describe("judgeSeam", () => {
  const judgeRequests = (kept: KeptTip, vars: Record<string, string> = {}) => {
    const requests: StepRequest[] = []
    installContext({
      ...fixtureContext({ vars }),
      matches: globMatches,
      step: async (request: StepRequest) => {
        requests.push(request)
        return { answers: { shape: { answer: "land", p: 0.9 } }, truncated: [] }
      },
    } as unknown as FlowContext)
    return judgeSeam(kept).then(() => requests)
  }

  it.each([
    ["src/foo*bar.ts", "src/foobar.ts"],
    ["src/**", "src/deep/foobar.ts"],
  ])("added %s does not cover modified %s", async (added, sibling) => {
    const requests = await judgeRequests(tip(change(added, "added"), change(sibling, "modified")))
    const request = requests[0]
    if (request?.kind !== "judge") throw new Error("expected a judge step")
    expect(JSON.parse(request.evidence.strays as string)).toEqual([sibling])
    expect(JSON.parse(request.evidence.inAllowlist as string)).toContain(added)
  })

  it("splits seamAllow on commas, trims entries and drops blanks", async () => {
    const requests = await judgeRequests(tip(change("src/x.ts", "modified")), {
      seamAllow: " a/** , ,b.ts,, ",
    })
    const request = requests[0]
    if (request?.kind !== "judge") throw new Error("expected a judge step")
    expect(JSON.parse(request.evidence.allow as string)).toEqual(["a/**", "b.ts"])
  })

  it("exempts only added paths: a deleted path stays a stray", async () => {
    const requests = await judgeRequests(tip(change("src/gone.ts", "deleted")))
    const request = requests[0]
    if (request?.kind !== "judge") throw new Error("expected a judge step")
    expect(JSON.parse(request.evidence.strays as string)).toEqual(["src/gone.ts"])
  })
})

describe("naivePass", () => {
  const capture = (rejection?: { strays: string[]; p: number }) =>
    captureStep(() => naivePass(rejection), { scope: "seam" })

  it("keeps its turn under the step name seam.naive", async () => {
    const request = await capture()
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("naive")
    expect(request.options).toMatchObject({ keep: true })
  })

  it("runs on the coder model, base by default, the coderModel setting otherwise", async () => {
    const plain = await capture()
    const set = await captureStep(() => naivePass(), {
      scope: "seam",
      env: { coderModel: "sonnet" },
    })
    if (plain.kind !== "agent" || set.kind !== "agent") throw new Error("unreachable")
    expect(plain.options.model).toBe("base")
    expect(set.options.model).toBe("sonnet")
  })

  it("carries the rejection into the retry prompt", async () => {
    const request = await capture({ strays: ["src/core.ts"], p: 0.8 })
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).toContain("src/core.ts")
    expect(request.prompt).toContain("0.8")
  })
})

describe("naiveAcceptance", () => {
  it("carries every test file the pass added or changed, named or not", () => {
    installContext({ ...fixtureContext({}), matches: globMatches } as unknown as FlowContext)
    expect(
      naiveAcceptance(
        tip(
          change("src/a.test.ts", "modified"),
          change("tests/b.feature", "added"),
          change("src/gone.test.ts", "deleted"),
          change("src/calc.ts", "modified"),
          change(".gtd/x.test.ts", "added"),
        ),
      ),
    ).toEqual({ hash: "abc", tests: ["src/a.test.ts", "tests/b.feature"] })
  })
})

describe("acceptanceFault", () => {
  const file = (path: string, status: Change["status"], after: string): Change => ({
    path,
    status,
    before: status === "added" ? undefined : "",
    after,
  })
  const refusal = (...changes: Change[]): string | undefined => {
    installContext({ ...fixtureContext({}), matches: globMatches } as unknown as FlowContext)
    return acceptanceFault(tip(...changes))
  }
  const tagged = 'import { add } from "../src/calc.js"\nit("adds")'

  it("refuses a test importing a file the pass added, resolved from the test's directory", () => {
    const message = refusal(
      file("src/naive/helper.ts", "added", "export const h = 1"),
      file("src/naive/helper.test.ts", "added", `import { h } from "./helper.js"\n${tagged}`),
    )
    expect(message).toMatch(/^acceptance-internals: /)
    expect(message).toContain("src/naive/helper.test.ts → src/naive/helper.ts")
  })

  it("refuses an aliased or directory import of an added module", () => {
    const added = file("src/naive/index.ts", "added", "")
    expect(
      refusal(added, file("tests/a.test.ts", "added", `import "@/naive"\n${tagged}`)),
    ).toContain("acceptance-internals")
    expect(
      refusal(added, file("tests/a.test.ts", "added", `import "../src/naive/index.js"\n${tagged}`)),
    ).toContain("acceptance-internals")
  })

  it("refuses a bare . or .. import of an added index", () => {
    expect(
      refusal(
        file("src/naive/index.ts", "added", ""),
        file("src/naive/__tests__/a.test.ts", "added", `import { x } from ".."\n${tagged}`),
      ),
    ).toContain("acceptance-internals")
  })

  it("reads a URL route or path-like data as no import", () => {
    expect(
      refusal(
        file("src/routes/users.ts", "added", ""),
        file(
          "tests/a.test.ts",
          "added",
          `request(app).get("/users")\nrun("src/routes/users.ts")\n${tagged}`,
        ),
      ),
    ).toBe(undefined)
  })

  it("reads no import out of a .feature file", () => {
    expect(
      refusal(
        file("src/subtract.ts", "added", ""),
        file("features/calc.feature", "added", `Given a file "src/subtract.ts"\n${tagged}`),
      ),
    ).toBe(undefined)
  })

  it("skips commented-out imports and takes a package subpath as no repository path", () => {
    expect(
      refusal(
        file("src/naive/helper.ts", "added", ""),
        file("src/date-fns/format.ts", "added", ""),
        file(
          "src/naive/a.test.ts",
          "added",
          `// import { h } from "./helper.js"\nimport { format } from "date-fns/format"\n${tagged}`,
        ),
      ),
    ).toBe(undefined)
  })

  it("lets a test reach an existing module, a same-named file elsewhere, or a URL", () => {
    expect(
      refusal(
        file("src/naive/api.ts", "added", ""),
        file("src/calc.ts", "modified", ""),
        file(
          "tests/a.test.ts",
          "added",
          `import "../src/calc.js"\nimport "./api.js"\nfetch("https://x/api")\n${tagged}`,
        ),
      ),
    ).toBe(undefined)
  })
})

const REVIEW = ".gtd/REVIEW.md"
const REFACTOR = ".gtd/REFACTOR.md"
const NOTE = ".gtd/REFACTOR-NOTE.md"
const reviewDoc = [
  "# Review: abc1234",
  "",
  "<!-- base: 0000000000000000000000000000000000000000 -->",
  "",
  "## calc",
  "- [ ] ./src/a.ts#1-1",
  "add",
  "",
].join("\n")

interface Seamed {
  readonly names: string[]
  readonly outcome: SeamOutcome | Error
}

const FLAGGED = "# Requirements\n\n## Release Flag\n\nnew\n"

/** Runs `seamBuild` against a scripted context: the judge answers `answer`, every review signs off. */
const driveSeam = async (
  answer: string,
  stray: Change = change("src/a.ts", "modified"),
  vars: Record<string, string> = {},
  reds = 0,
  requirements = FLAGGED,
): Promise<Seamed> => {
  let red = false
  let redsLeft = reds
  const names: string[] = []
  const stack: string[] = []
  const files = new Map<string, string>([
    ["src/a.ts", "a"],
    [".gtd/REQUIREMENTS.md", requirements],
  ])
  let current = "c0"
  const effects: Record<string, () => void> = {
    note: () => void files.set(NOTE, "Seam: a shared op"),
    deriving: () => void files.set(REFACTOR, "package"),
    closing: () => void files.delete(REFACTOR),
    "review.reviewing": () => void files.set(REVIEW, reviewDoc),
    "review.closing": () => {
      files.delete(REVIEW)
      current = "after-refactor"
    },
  }
  installContext({
    ...fixtureContext({ vars: { refactorQualityReviews: "", ...vars } }),
    matches: globMatches,
    refuse: (message: string) => {
      throw new Error(message)
    },
    pushScope: (scope: { name?: string }) => void stack.push(scope.name ?? ""),
    popScope: () => void stack.pop(),
    read: (path: string) => files.get(path),
    head: () => current,
    kept: () => tip(stray),
    changes: () => (red ? [change(".gtd/FEEDBACK.md", "added")] : []),
    changesSince: () => [],
    step: (request: StepRequest) => {
      if (request.kind === "restart") return Promise.resolve()
      const full = [...stack, request.name].join(".")
      red = full === "seam.check" && redsLeft-- > 0
      if (full === "seam.check") {
        if (red) files.set(".gtd/FEEDBACK.md", "FAIL")
        else files.delete(".gtd/FEEDBACK.md")
      }
      if (full === "seam.clear") files.delete(".gtd/FEEDBACK.md")
      names.push(full)
      effects[request.name]?.()
      if (request.kind === "judge")
        return Promise.resolve({ answers: { shape: { answer, p: 0.9 } }, truncated: [] })
      return Promise.resolve(undefined)
    },
  } as unknown as FlowContext)
  let outcome: SeamOutcome | Error
  try {
    outcome = await seamBuild("c-base")
  } catch (error) {
    outcome = error as Error
  }
  return { names, outcome }
}

describe("seamBuild", () => {
  it("land resolves the kept tip to land, with the caller's base", async () => {
    const h = await driveSeam("land")
    expect(h.outcome).toEqual({ reference: "abc", base: "c-base", land: true })
    expect(h.names).toEqual(["seam.naive", "seam.check", "seam.judge"])
  })

  it("with no release flag asked for resolves a vetted pass to land with no judge", async () => {
    const h = await driveSeam("reject", undefined, {}, 0, "# Requirements\n")
    expect(h.outcome).toEqual({ reference: "abc", base: "c-base", land: true })
    expect(h.names).toEqual(["seam.naive", "seam.check"])
  })

  it("a red check retries the pass, and the judge sees it only once green", async () => {
    const h = await driveSeam("land", undefined, {}, 1)
    expect(h.names).toEqual(["seam.naive", "seam.check", "seam.naive", "seam.check", "seam.judge"])
  })

  it("an overruled red pass gets a fresh budget for the judge's rejects", async () => {
    const h = await driveSeam("reject", undefined, {}, 3)
    const steers = h.names.flatMap((name, i) => (name === "seam.steer" ? [i] : []))
    expect(steers).toHaveLength(2)
    expect(h.names.slice(steers[0]! + 1, steers[1]).filter((n) => n === "seam.judge")).toHaveLength(
      3,
    )
  })

  it("a third red rests at seam.steer, and a clean landing there takes the red pass to the judge", async () => {
    const h = await driveSeam("land", undefined, {}, 3)
    expect(h.names).toEqual([
      "seam.naive",
      "seam.check",
      "seam.naive",
      "seam.check",
      "seam.naive",
      "seam.check",
      "seam.steer",
      "seam.clear",
      "seam.judge",
    ])
    expect(h.outcome).toEqual({ reference: "abc", base: "c-base", land: true })
  })

  it("refactor-first runs the reviewed refactor right after the note and resolves HEAD after it", async () => {
    const h = await driveSeam("refactor-first")
    expect(h.outcome).toEqual({
      reference: "abc",
      base: "after-refactor",
      refactored: true,
      rebuild: { note: "Seam: a shared op", acceptance: { hash: "abc", tests: [] } },
    })
    expect(h.names.indexOf("seam.note")).toBe(h.names.indexOf("seam.judge") + 1)
    expect(h.names.indexOf("refactor.deriving")).toBe(h.names.indexOf("seam.note") + 1)
    expect(h.names).toContain("refactor.build.review.closing")
    expect(h.names.some((n) => n.includes("approve"))).toBe(false)
    expect(h.names.some((n) => n.startsWith("implement"))).toBe(false)
  })

  it("refactor-first with only test-file strays resolves the caller's base with no refactor and no by-hand", async () => {
    const h = await driveSeam("refactor-first", change("src/a.test.ts", "modified"), {
      seamAllow: ".gtd/**",
    })
    expect(h.outcome).toEqual({
      reference: "abc",
      base: "c-base",
      rebuild: { acceptance: { hash: "abc", tests: ["src/a.test.ts"] } },
    })
    expect(h.names).not.toContain("seam.by-hand")
    expect(h.names.some((n) => n.startsWith("refactor"))).toBe(false)
  })

  it("rests an unreadable test-file stray at seam.by-hand", async () => {
    const h = await driveSeam(
      "refactor-first",
      { path: "src/a.test.ts", status: "modified", before: undefined, after: "b" },
      { seamAllow: ".gtd/**" },
    )
    expect(h.names).toContain("seam.by-hand")
  })

  it("rests unreadable strays at seam.by-hand and runs no refactor", async () => {
    const h = await driveSeam("refactor-first", {
      path: "src/a.ts",
      status: "modified",
      before: undefined,
      after: "b",
    })
    expect(h.names).toContain("seam.by-hand")
    expect(h.outcome).toEqual({
      reference: "abc",
      base: "c-base",
      rebuild: { acceptance: { hash: "abc", tests: [] } },
    })
  })
})

describe("implement", () => {
  let lastOptions: Extract<StepRequest, { kind: "agent" }>["options"] | undefined
  let requirements = FLAGGED
  const building = async (
    reference: string | undefined,
    tier?: "low" | "high",
    amend?: boolean,
    call: () => Promise<void> = () => implement({ reference, tier, amend }),
  ) => {
    const requests: StepRequest[] = []
    lastOptions = undefined
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            requests.push(request)
            return Promise.resolve(
              request.kind === "judge" ? { answers: {}, truncated: [] } : undefined,
            )
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          changesSince: () => [],
          read: (path: string) => (path === ".gtd/REQUIREMENTS.md" ? requirements : undefined),
        },
      ),
    )
    await call()
    const request = requests.find((r) => r.kind === "agent" && r.name === "building")
    if (request?.kind !== "agent") throw new Error("no building turn")
    lastOptions = request.options
    return request.prompt
  }

  it("builds on the coder model", async () => {
    await building("abc")
    expect(lastOptions?.model).toBe("base")
  })

  it("after a refactor, lets an empty turn complete the step and says so", async () => {
    const prompt = await building("abc", undefined, undefined, () =>
      implement({ reference: "abc", afterRefactor: true }),
    )
    expect(lastOptions?.allowEmpty).toBe(true)
    expect(prompt).toMatch(/change\s+nothing and finish your turn/)
  })

  it("without a refactor, an empty turn stays an attempt", async () => {
    const prompt = await building("abc")
    expect(lastOptions?.allowEmpty).toBeUndefined()
    expect(prompt).not.toMatch(/change\s+nothing/)
  })

  it("the deprecated positional form renders the same prompt as the options form", async () => {
    const modern = await building("abc", "low")
    const legacy = await building("abc", "low", undefined, () => implement("abc", "low"))
    expect(legacy).toBe(modern)
    expect(legacy).toContain("git show abc")
    const amended = await building(undefined, undefined, true)
    expect(
      await building(undefined, undefined, undefined, () => implement(undefined, undefined, true)),
    ).toBe(amended)
    const bare = await building(undefined, undefined, undefined, () => implement())
    expect(bare).toBe(await building(undefined))
  })

  it("a rebuild quotes the refactor note and names the naive acceptance tests to carry over", async () => {
    const prompt = await building("abc", undefined, undefined, () =>
      implement({
        reference: "abc",
        rebuild: {
          note: "# Note\n\nSeam: a shared op",
          acceptance: { hash: "abc", tests: ["src/a.test.ts"] },
        },
      }),
    )
    expect(prompt).toContain("  > Seam: a shared op")
    expect(prompt).toContain("git show abc -- 'src/a.test.ts'")
  })

  it("a rebuild whose naive pass wrote no test asks to carry nothing over", async () => {
    const prompt = await building("abc", undefined, undefined, () =>
      implement({ reference: "abc", rebuild: { acceptance: { hash: "abc", tests: [] } } }),
    )
    expect(prompt).not.toContain("Carry over")
    expect(prompt).not.toContain("refactor note")
  })

  it("names the reference with a git show line", async () => {
    expect(await building("abc")).toContain("git show abc")
  })

  it("carries no git show line without a reference", async () => {
    expect(await building(undefined)).not.toContain("git show")
  })

  it("first lap renders the reference line and the fresh-write wording", async () => {
    const prompt = await building("abc")
    expect(prompt).toContain("git show abc")
    expect(prompt).toContain("Implement them properly")
    expect(prompt).toContain("write\n  the change fresh")
    expect(prompt).toContain("new release flag")
  })

  it("amend says the change exists, keeps the earlier flag and asks for no new one", async () => {
    const prompt = await building(undefined, undefined, true)
    expect(prompt).toContain("already exists")
    expect(prompt).toContain("amend")
    expect(prompt).toContain("Keep the release flag")
    expect(prompt).toContain("if it added one")
    expect(prompt).not.toContain("implement them properly")
    expect(prompt).not.toContain("Implement them properly")
    expect(prompt).not.toContain("write the change fresh")
    expect(prompt).toContain("otherwise put")
  })

  it("asks for no release flag when the requirements ask for none, whatever the tier", async () => {
    requirements = "# Requirements\n"
    try {
      const prompt = await building(undefined, "high", true)
      expect(prompt).toContain("Add no release flag")
      expect(prompt).toContain("amend")
    } finally {
      requirements = FLAGGED
    }
  })
})
