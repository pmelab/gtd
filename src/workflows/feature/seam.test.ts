import { afterEach, describe, expect, it } from "vitest"
import { installContext, type Change, type KeptTip } from "../../flows/index.js"
import { fixtureContext } from "../shared/text.fixture.js"
import { naivePass, seamAllowlist } from "./seam.js"
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

const allowlist = (kept: KeptTip, vars: Record<string, string> = {}): string[] => {
  installContext(fixtureContext({ vars }))
  return seamAllowlist(kept)
}

describe("seamAllowlist", () => {
  it("is the default list plus every added path, never a modified one", () => {
    const list = allowlist(tip(change("src/new.ts", "added"), change("src/old.ts", "modified")))
    expect(list).toContain("**/*.test.*")
    expect(list).toContain("src/new.ts")
    expect(list).not.toContain("src/old.ts")
  })

  it("splits seamAllow on commas, trims entries and drops blanks", () => {
    expect(allowlist(tip(), { seamAllow: " a/** , ,b.ts,, " })).toEqual(["a/**", "b.ts"])
  })

  it("ignores a deleted path", () => {
    expect(allowlist(tip(change("src/gone.ts", "deleted")), { seamAllow: "x" })).toEqual(["x"])
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
