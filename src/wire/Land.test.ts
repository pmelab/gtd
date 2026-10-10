import { describe, expect, it } from "vitest"
import {
  landFields,
  landProseText,
  noopText,
  renderLandJson,
  renderLandPlain,
  type LandFields,
  type LandResultSource,
} from "./Land.js"
import { WIRE_SCHEMA } from "./index.js"

describe("landFields / renderLandJson", () => {
  const sample: LandFields = {
    schema: WIRE_SCHEMA,
    script: "printf '%s %s\\n' '[commit]' 'gtd(agent): build.fixing'\ngit commit ...\n",
    settled: false,
    idle: false,
    state: "build.review.closing",
    subject: "gtd(agent): build.fixing",
    cost: 0.42,
    model: "smart",
  }

  it("renderLandJson emits exactly schema/script/settled/idle/state/subject/cost/model, newline-terminated", () => {
    const line = renderLandJson(landFields(sample))
    expect(line.endsWith("\n")).toBe(true)
    expect(JSON.parse(line)).toEqual(sample)
  })

  it("renderLandJson carries null subject/cost/model verbatim for a genuine no-op — never omitted", () => {
    const noop: LandFields = {
      schema: WIRE_SCHEMA,
      script: "printf '%s\\n' 'nothing to do at \"idle\"'\n",
      settled: true,
      idle: true,
      state: "idle",
      subject: null,
      cost: null,
      model: null,
    }
    expect(renderLandJson(landFields(noop))).toBe(JSON.stringify(noop) + "\n")
  })

  it("landFields is a real reorder, not an identity copy: takes a LandResultSource-shaped value (program.ts's LandResult field order) and pins it into LandFields' own declared order", () => {
    // Written in `LandResultSource`'s (== `LandResult`'s) own field order —
    // state/subject/cost/model/script/settled/idle — the opposite of
    // `LandFields`' script/settled/idle/state/subject/cost/model, so this
    // test would fail if `landFields` stopped reordering.
    const resultShaped: LandResultSource = {
      state: "build.review.closing",
      subject: "gtd(agent): build.fixing",
      cost: 0.42,
      model: "smart",
      script: "printf '%s %s\\n' '[commit]' 'gtd(agent): build.fixing'\ngit commit ...\n",
      settled: false,
      idle: false,
    }
    expect(Object.keys(landFields(resultShaped))).toEqual([
      "schema",
      "script",
      "settled",
      "idle",
      "state",
      "subject",
      "cost",
      "model",
    ])
  })
})

describe("noopText / landProseText", () => {
  it("noopText names the state", () => {
    expect(noopText("idle")).toBe('nothing to do at "idle"\n')
  })

  it("landProseText names the commit subject, newline-terminated", () => {
    expect(landProseText("gtd(human): idle → working")).toBe(
      "commit everything with this message: gtd(human): idle → working\n",
    )
  })

  it("landProseText carries no ANSI escape sequence", () => {
    // eslint-disable-next-line no-control-regex -- asserting the ABSENCE of an escape byte
    expect(landProseText("gtd(agent): drafting")).not.toMatch(/\x1b/)
  })
})

describe("renderLandPlain", () => {
  const sample: LandFields = {
    schema: WIRE_SCHEMA,
    script: "printf '%s %s\\n' '[commit]' 'gtd(agent): build.fixing'\ngit commit ...\n",
    settled: false,
    idle: false,
    state: "build.review.closing",
    subject: "gtd(agent): build.fixing",
    cost: 0.42,
    model: "smart",
  }

  it("names the commit subject and points at gtd land --json=script at a real landing", () => {
    const plain = renderLandPlain(sample)
    expect(plain).toContain("gtd(agent): build.fixing")
    expect(plain).toContain("gtd land --json=script")
  })

  it("prints the no-op note when nothing landed", () => {
    const noop: LandFields = {
      schema: WIRE_SCHEMA,
      script: "printf '%s\\n' 'nothing to do at \"idle\"'\n",
      settled: true,
      idle: true,
      state: "idle",
      subject: null,
      cost: null,
      model: null,
    }
    expect(renderLandPlain(noop)).toBe(noopText("idle"))
  })
})
