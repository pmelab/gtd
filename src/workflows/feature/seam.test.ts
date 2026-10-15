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
import { judgeSeam, naivePass } from "./seam.js"
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
