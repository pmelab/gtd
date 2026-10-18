import { afterEach, describe, expect, it } from "vitest"
import { installContext, type FlowContext } from "../../flows/index.js"
import { fixtureContext } from "../shared/text.fixture.js"
import { productionSignals, readRiskTier, recordRisk, riskTierOn } from "./tier.js"

afterEach(() => installContext(undefined))

const withVars = (vars: Record<string, string>) => installContext(fixtureContext({ vars }))

describe("riskTierOn", () => {
  it.each([
    [{ flag_naive_pass: "1", flag_risk_tier: "1" }, true],
    [{ flag_naive_pass: "1", flag_risk_tier: "0" }, false],
    [{ flag_naive_pass: "0", flag_risk_tier: "1" }, false],
    [{ flag_naive_pass: "0", flag_risk_tier: "0" }, false],
    [{ flag_naive_pass: "1" }, false],
  ])("%j is %s", (vars, expected) => {
    withVars(vars)
    expect(riskTierOn()).toBe(expected)
  })
})

describe("readRiskTier", () => {
  const doc = (body: string) =>
    `# Requirements\n\n## Risk Tier\n\n${body}\n\n## Answered Questions\n`

  it.each(["low", "`low`", "**Low** — trivial copy", "LOW - copy", "_low_ — x"])(
    "reads %j as low",
    (body) => expect(readRiskTier(doc(body))).toBe("low"),
  )

  it.each(["high", "medium", "lower", "", "   \n\n"])("reads %j as high", (body) =>
    expect(readRiskTier(doc(body))).toBe("high"),
  )

  it("reads a missing section and undefined as high", () => {
    expect(readRiskTier("# Requirements\n\n## Other\n\nlow\n")).toBe("high")
    expect(readRiskTier(undefined)).toBe("high")
  })

  it("takes the first non-blank line only and stops at the next section", () => {
    expect(readRiskTier("## Risk Tier\n\nhigh — why\nlow\n")).toBe("high")
    expect(readRiskTier("## Risk Tier\n\n## Other\n\nlow\n")).toBe("high")
  })
})

describe("readRiskTier fences", () => {
  it("ignores a backtick-fenced example above the real section", () => {
    const text = "```\n## Risk Tier\n\nlow\n```\n\n## Risk Tier\n\nhigh\n"
    expect(readRiskTier(text)).toBe("high")
  })

  it("reads a fenced example with no real section as high", () => {
    expect(readRiskTier("```md\n## Risk Tier\n\nlow\n```\n")).toBe("high")
  })

  it("keeps the signals section open across a fence and skips fenced items", () => {
    const signals = "## Production Signals\n- before\n```\n# x\n- fake\n```\n- after\n"
    expect(productionSignals(signals)).toEqual(["before", "after"])
  })

  it("ignores a tilde-fenced example above the real section", () => {
    const text = "~~~\n## Risk Tier\n\nlow\n~~~\n\n## Risk Tier\n\nhigh\n"
    expect(readRiskTier(text)).toBe("high")
  })

  it("does not read a fence opener's info string as the tier", () => {
    expect(readRiskTier("## Risk Tier\n\n```low\nhigh\n```\n")).toBe("high")
    expect(readRiskTier("## Risk Tier\n\n~~~low\nlow\n~~~\n")).toBe("high")
  })

  it("fails closed on an unclosed fence before the real section", () => {
    expect(readRiskTier("```\nstray\n\n## Risk Tier\n\nlow\n")).toBe("high")
  })

  it("does not close a 4-backtick fence with 3 backticks", () => {
    const text = "````\n```\n## Risk Tier\n\nlow\n````\n"
    expect(readRiskTier(text)).toBe("high")
  })

  it("does not open a fence on a backtick line indented 4 spaces", () => {
    expect(readRiskTier("    ```\n## Risk Tier\n\nlow\n")).toBe("low")
  })
})

describe("readRiskTier fence closers", () => {
  it.each([
    ["a tilde line does not close a backtick fence", "```\n~~~\n## Risk Tier\n\nlow\n```\n"],
    ["a closer with an info string does not close", "```\n```js\n## Risk Tier\n\nlow\n```\n"],
  ])("%s", (_, text) => {
    expect(readRiskTier(text)).toBe("high")
  })
})

describe("productionSignals", () => {
  it("lists top-level items only, skipping blanks and indented lines", () => {
    const text = `## Production Signals

- error rate on /pay
  not a signal
  - nested detail
-
-    spaced   out\t signal
* star item

## Answered Questions

- not a signal
`
    expect(productionSignals(text)).toEqual([
      "error rate on /pay",
      "spaced out signal",
      "star item",
    ])
  })

  it("skips a fenced Production Signals example", () => {
    const text = "```\n## Production Signals\n- fake\n```\n\n## Production Signals\n- real\n"
    expect(productionSignals(text)).toEqual(["real"])
  })

  it("drops control characters", () => {
    expect(productionSignals("## Production Signals\n- a\u001bb\u0085c\n")).toEqual(["abc"])
  })

  it("is empty for a missing section or undefined", () => {
    expect(productionSignals("## Risk Tier\nlow\n")).toEqual([])
    expect(productionSignals(undefined)).toEqual([])
  })
})

describe("recordRisk", () => {
  const record = (requirements: string | undefined) => {
    const marks: [string, string][] = []
    installContext({
      ...fixtureContext({ read: () => requirements }),
      mark: (name: string, value: string) => marks.push([name, value]),
    } as unknown as FlowContext)
    return { tier: recordRisk(), marks }
  }

  it("marks the tier first, then one production-signal each", () => {
    const { tier, marks } = record(
      "## Risk Tier\nhigh — payments\n\n## Production Signals\n- a\n- b\n",
    )
    expect(tier).toBe("high")
    expect(marks).toEqual([
      ["risk-tier", "high"],
      ["production-signal", "a"],
      ["production-signal", "b"],
    ])
  })

  it("marks risk-tier=low too", () => {
    const { tier, marks } = record("## Risk Tier\nlow — copy\n\n## Production Signals\n- a\n")
    expect(tier).toBe("low")
    expect(marks).toEqual([
      ["risk-tier", "low"],
      ["production-signal", "a"],
    ])
  })

  it("treats a missing file as high", () => {
    const { tier, marks } = record(undefined)
    expect(tier).toBe("high")
    expect(marks).toEqual([["risk-tier", "high"]])
  })
})
