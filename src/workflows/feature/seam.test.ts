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
import { implement, judgeSeam, naivePass, seamBuild, type SeamOutcome } from "./seam.js"
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

  it("carries the rejection into the retry prompt", async () => {
    const request = await capture({ strays: ["src/core.ts"], p: 0.8 })
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).toContain("src/core.ts")
    expect(request.prompt).toContain("0.8")
  })
})

const REVIEW = ".gtd/REVIEW.md"
const REFACTOR = ".gtd/REFACTOR.md"
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
  readonly slices: string[]
  /** Slice names entered, with the steps seen while inside each. */
  readonly inside: Record<string, string[]>
  readonly outcome: SeamOutcome | Error
}

/** Runs `seamBuild` against a scripted context: the judge answers `answer`, every review signs off. */
const driveSeam = async (
  answer: string,
  stray: Change = change("src/a.ts", "modified"),
  vars: Record<string, string> = {},
): Promise<Seamed> => {
  const names: string[] = []
  const slices: string[] = []
  const inside: Record<string, string[]> = {}
  const stack: string[] = []
  const open: string[] = []
  const files = new Map<string, string>([["src/a.ts", "a"]])
  let current = "c0"
  const effects: Record<string, () => void> = {
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
    enterSlice: (name: string) => {
      slices.push(name)
      open.push(name)
      inside[name] = []
    },
    leaveSlice: () => void open.pop(),
    read: (path: string) => files.get(path),
    head: () => current,
    kept: () => tip(stray),
    changes: () => [],
    changesSince: () => [],
    step: (request: StepRequest) => {
      if (request.kind === "restart") return Promise.resolve()
      const full = [...stack, request.name].join(".")
      names.push(full)
      for (const name of open) inside[name]!.push(full)
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
  return { names, slices, inside, outcome }
}

describe("seamBuild", () => {
  it("land resolves the kept tip with the caller's base and enters no slice", async () => {
    const h = await driveSeam("land")
    expect(h.outcome).toEqual({ reference: "abc", base: "c-base" })
    expect(h.slices).toEqual([])
    expect(h.names).toEqual(["seam.naive", "seam.judge"])
  })

  it("refactor-first runs the reviewed refactor in slice refactor and resolves HEAD after it", async () => {
    const h = await driveSeam("refactor-first")
    expect(h.outcome).toEqual({ reference: "abc", base: "after-refactor" })
    expect(h.slices).toEqual(["refactor"])
    expect(h.inside.refactor![0]).toBe("refactor.deriving")
    expect(h.inside.refactor).toContain("refactor.build.review.closing")
    expect(h.names.some((n) => n.includes("approve"))).toBe(false)
    expect(h.names.some((n) => n.startsWith("implement"))).toBe(false)
  })

  it("refactor-first with only test-file strays resolves the caller's base with no slice and no by-hand", async () => {
    const h = await driveSeam("refactor-first", change("src/a.test.ts", "modified"), {
      seamAllow: ".gtd/**",
    })
    expect(h.outcome).toEqual({ reference: "abc", base: "c-base" })
    expect(h.slices).toEqual([])
    expect(h.names).not.toContain("seam.by-hand")
    expect(h.names.some((n) => n.startsWith("refactor"))).toBe(false)
  })

  it("rests an unreadable test-file stray at seam.by-hand", async () => {
    const h = await driveSeam(
      "refactor-first",
      { path: "src/a.test.ts", status: "modified", before: undefined, after: "b" },
      { seamAllow: ".gtd/**" },
    )
    expect(h.slices).toEqual([])
    expect(h.names).toContain("seam.by-hand")
  })

  it("rests unreadable strays at seam.by-hand and enters no refactor slice", async () => {
    const h = await driveSeam("refactor-first", {
      path: "src/a.ts",
      status: "modified",
      before: undefined,
      after: "b",
    })
    expect(h.slices).toEqual([])
    expect(h.names).toContain("seam.by-hand")
    expect(h.outcome).toEqual({ reference: "abc", base: "c-base" })
  })
})

describe("implement", () => {
  const building = async (
    reference: string | undefined,
    tier?: "low" | "high",
    amend?: boolean,
  ) => {
    const requests: StepRequest[] = []
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            requests.push(request)
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          changesSince: () => [],
        },
      ),
    )
    await implement(reference, tier, amend)
    const request = requests.find((r) => r.kind === "agent" && r.name === "building")
    if (request?.kind !== "agent") throw new Error("no building turn")
    return request.prompt
  }

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

  it("amend on tier low says to add no release flag", async () => {
    const prompt = await building(undefined, "low", true)
    expect(prompt).toContain("Add no release flag")
    expect(prompt).toContain("amend")
  })
})
