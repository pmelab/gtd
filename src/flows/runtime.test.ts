import { afterEach, describe, expect, it } from "vitest"
import {
  FLOWS_PROTOCOL,
  FlowsProtocolError,
  head,
  installContext,
  kept,
  protocolMismatch,
  type FlowContext,
} from "./runtime.js"

afterEach(() => installContext(undefined))

const context = { head: () => "h1" } as unknown as FlowContext
const globals = globalThis as Record<symbol, unknown>
const CONTEXT_KEY = Symbol.for("@pmelab/gtd/flow-context")
const PROTOCOL_KEY = Symbol.for("@pmelab/gtd/flow-protocol")

describe("the flows protocol handshake", () => {
  it("reads the context when the engine installed the facade's protocol", () => {
    installContext(context)
    expect(head()).toBe("h1")
  })

  it("tells a newer engine to have the workflow's package upgraded", () => {
    installContext(context)
    globals[PROTOCOL_KEY] = FLOWS_PROTOCOL + 1
    expect(() => head()).toThrow(FlowsProtocolError)
    expect(() => head()).toThrow(
      `gtd: the workflow speaks flows protocol ${FLOWS_PROTOCOL}, but the engine installed protocol ${FLOWS_PROTOCOL + 1} — upgrade the @pmelab/gtd the workflow imports`,
    )
    expect(protocolMismatch()).toBeInstanceOf(FlowsProtocolError)
  })

  it("tells an older engine to be upgraded", () => {
    installContext(context)
    globals[PROTOCOL_KEY] = FLOWS_PROTOCOL - 1
    expect(() => head()).toThrow(
      `engine installed protocol ${FLOWS_PROTOCOL - 1} — upgrade the gtd that runs it`,
    )
  })

  // Must go red once FLOWS_PROTOCOL passes 1: a pre-handshake engine is v1.
  it("accepts an engine that installs no protocol number", () => {
    delete globals[PROTOCOL_KEY]
    globals[CONTEXT_KEY] = context
    expect(head()).toBe("h1")
  })

  it("keeps the outside-a-replay error when nothing is installed", () => {
    expect(() => head()).toThrow(
      new Error("gtd: a workflow step or helper was called outside a gtd replay"),
    )
  })
})

describe("kept()", () => {
  const change = { path: "a.ts", status: "added", before: undefined, after: "a" } as const
  const withKept = (tip: unknown) =>
    installContext({
      kept: (name: string) => (name === "naive" ? tip : undefined),
    } as unknown as FlowContext)

  it("returns undefined as given", () => {
    withKept(undefined)
    expect(kept("naive")).toBeUndefined()
  })

  it("wraps a tip's changes with paths and get", () => {
    withKept({ hash: "abc", changes: [change] })
    const tip = kept("naive")
    expect(tip?.hash).toBe("abc")
    expect(tip?.changes.paths).toEqual(["a.ts"])
    expect(tip?.changes.get("a.ts")?.after).toBe("a")
    expect(tip?.changes.get("b.ts")).toBeUndefined()
    expect(tip?.changes).toHaveLength(1)
    expect(kept("other")).toBeUndefined()
  })

  it("throws the upgrade message on a context without kept, protocol still 1", () => {
    installContext(context)
    expect(() => kept("naive")).toThrow(
      "gtd: kept() needs a newer gtd — upgrade the gtd that runs it",
    )
    expect(FLOWS_PROTOCOL).toBe(1)
  })
})
