import { afterEach, describe, expect, it } from "vitest"
import {
  installContext,
  judgeDiffShape,
  type Change,
  type FlowContext,
  type JudgeAnswer,
  type StepRequest,
} from "../flows/index.js"
import { globMatches } from "../wire/index.js"

// Lives in replay, which wires `matches: globMatches` (flows tests may not import wire).
afterEach(() => installContext(undefined))

const change = (
  path: string,
  status: Change["status"],
  before?: string,
  after?: string,
): Change => ({
  path,
  status,
  before,
  after,
})

const install = (
  verdict: { shape?: JudgeAnswer | undefined; truncated?: string[] } | "none",
  vars: Record<string, string> = {},
) => {
  const requests: StepRequest[] = []
  installContext({
    matches: globMatches,
    vars,
    step: async (request: StepRequest) => {
      requests.push(request)
      return {
        answers: { shape: verdict === "none" ? undefined : verdict.shape },
        truncated: verdict === "none" ? [] : (verdict.truncated ?? []),
      }
    },
  } as unknown as FlowContext)
  return requests
}

const naive = [
  change("src/a.ts", "modified", "a1", "a2"),
  change("z/new.ts", "added", undefined, "new"),
  change("b/old.ts", "deleted", "old", undefined),
]

describe("judgeDiffShape", () => {
  it("answers land with no judge step when nothing strays", async () => {
    const requests = install("none")
    const result = await judgeDiffShape("shape", {
      changes: naive,
      allow: ["src/**", "z/**", "b/**"],
    })
    expect(result).toEqual({ choice: "land", strays: [], unreadable: [], judgment: undefined })
    expect(requests).toEqual([])
  })

  it("makes every path a stray when allow is empty", async () => {
    install({ shape: { answer: "land", p: 0.9 } })
    const result = await judgeDiffShape("shape", { changes: naive, allow: [] })
    expect(result.strays).toEqual(["b/old.ts", "src/a.ts", "z/new.ts"])
  })

  it("asks one choice question named shape with the three labels in its criteria", async () => {
    const requests = install({ shape: { answer: "land", p: 0.9 } })
    await judgeDiffShape("shape", { changes: naive, allow: ["src/**"] })
    expect(requests).toHaveLength(1)
    const request = requests[0]
    if (request?.kind !== "judge") throw new Error("expected a judge step")
    expect(request.name).toBe("shape")
    expect(request.questions).toHaveLength(1)
    const q = request.questions[0]
    expect(q).toMatchObject({ id: "shape", primitive: "choice" })
    for (const label of ["land", "refactor-first", "reject"]) expect(q?.criteria).toContain(label)
    expect(q?.criteria).toContain("strays a refactor could absorb never count as reject")
  })

  it("carries exactly four evidence keys, with stray content before/after and in-allowlist paths only", async () => {
    const requests = install({ shape: { answer: "land", p: 0.9 } })
    await judgeDiffShape("shape", { changes: naive, allow: ["src/**"] })
    const request = requests[0]
    if (request?.kind !== "judge") throw new Error("expected a judge step")
    expect(Object.keys(request.evidence).sort()).toEqual([
      "allow",
      "inAllowlist",
      "strayContent",
      "strays",
    ])
    expect(request.evidence.strays).toBe(JSON.stringify(["b/old.ts", "z/new.ts"], null, 2))
    expect(request.evidence.allow).toBe(JSON.stringify(["src/**"], null, 2))
    expect(request.evidence.inAllowlist).toBe(JSON.stringify(["src/a.ts"], null, 2))
    expect(request.evidence.strayContent).toBe(
      [
        "=== b/old.ts (deleted)",
        "--- before",
        "old",
        "=== z/new.ts (added)",
        "--- after",
        "new",
      ].join("\n"),
    )
    expect(request.evidence.strayContent).not.toContain("a2")
  })

  it("keeps modified strays' before and after", async () => {
    const requests = install({ shape: { answer: "land", p: 0.9 } })
    await judgeDiffShape("shape", { changes: naive, allow: ["b/**", "z/**"] })
    const request = requests[0]
    if (request?.kind !== "judge") throw new Error("expected a judge step")
    expect(request.evidence.strayContent).toBe(
      "=== src/a.ts (modified)\n--- before\na1\n--- after\na2",
    )
  })

  it.each(["land", "refactor-first", "reject"] as const)(
    "returns %s at or above minP",
    async (label) => {
      install({ shape: { answer: label, p: 0.7 } })
      const result = await judgeDiffShape("shape", { changes: naive, allow: [] })
      expect(result.choice).toBe(label)
    },
  )

  it("falls back to refactor-first below minP", async () => {
    install({ shape: { answer: "reject", p: 0.69 } })
    expect((await judgeDiffShape("shape", { changes: naive, allow: [] })).choice).toBe(
      "refactor-first",
    )
  })

  it("falls back to refactor-first on no verdict or an unknown answer", async () => {
    install("none")
    expect((await judgeDiffShape("shape", { changes: naive, allow: [] })).choice).toBe(
      "refactor-first",
    )
    install({ shape: { answer: "yolo", p: 1 } })
    expect((await judgeDiffShape("shape", { changes: naive, allow: [] })).choice).toBe(
      "refactor-first",
    )
  })

  it("prefers the minP option, then vars.judgeShapeMinP, then 0.7", async () => {
    const verdict = { shape: { answer: "land", p: 0.9 } }
    install(verdict, { judgeShapeMinP: "0.95" })
    expect((await judgeDiffShape("s", { changes: naive, allow: [] })).choice).toBe("refactor-first")
    expect((await judgeDiffShape("s", { changes: naive, allow: [], minP: 0.5 })).choice).toBe(
      "land",
    )
    install(verdict, {})
    expect((await judgeDiffShape("s", { changes: naive, allow: [] })).choice).toBe("land")
    install({ shape: { answer: "land", p: 0.6 } }, {})
    expect((await judgeDiffShape("s", { changes: naive, allow: [] })).choice).toBe("refactor-first")
  })

  it("never lands a blank judgeShapeMinP", async () => {
    install({ shape: { answer: "land", p: 1 } }, { judgeShapeMinP: "" })
    expect((await judgeDiffShape("s", { changes: naive, allow: [] })).choice).toBe("refactor-first")
  })

  it("takes refactor-first on truncated evidence and still returns the judgment", async () => {
    install({ shape: { answer: "land", p: 0.9 }, truncated: ["strayContent"] })
    const result = await judgeDiffShape("s", { changes: naive, allow: [] })
    expect(result.choice).toBe("refactor-first")
    expect(result.judgment?.truncated).toEqual(["strayContent"])
  })

  it.each([
    ["modified without before", change("m.ts", "modified", undefined, "a")],
    ["modified without after", change("m.ts", "modified", "a", undefined)],
    ["added without after", change("m.ts", "added", undefined, undefined)],
    ["deleted without before", change("m.ts", "deleted", undefined, undefined)],
  ])("takes refactor-first with no judge step for %s", async (_label, bad) => {
    const requests = install({ shape: { answer: "land", p: 1 } })
    const result = await judgeDiffShape("s", {
      changes: [change("z.ts", "added", undefined, "z"), bad],
      allow: [],
    })
    expect(result).toEqual({
      choice: "refactor-first",
      strays: ["m.ts", "z.ts"],
      unreadable: ["m.ts"],
      judgment: undefined,
    })
    expect(requests).toEqual([])
  })

  it("reads each lazy side once, so the readable check and the judged content agree", async () => {
    let reads = 0
    const lazy: Change = {
      path: "l.ts",
      status: "modified",
      before: "b",
      get after() {
        reads++
        return reads === 1 ? "a" : undefined
      },
    }
    install({ shape: { answer: "land", p: 0.9 } })
    const result = await judgeDiffShape("s", { changes: [lazy], allow: [] })
    expect(reads).toBe(1)
    expect(result.choice).toBe("land")
  })
})
