import { afterEach, describe, expect, expectTypeOf, it } from "vitest"
import {
  FLOWS_PROTOCOL,
  FlowsProtocolError,
  env,
  envSettings,
  envSettingsOf,
  head,
  human,
  installContext,
  isMarkedWorkflow,
  judge,
  kept,
  mark,
  protocolMismatch,
  settings,
  settingsOf,
  vars,
  workflow,
  type FlowContext,
  type HumanOptions,
  type Judgment,
  type ModeName,
  type Settings,
  type SteeringOptions,
  type StepRequest,
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

describe("mark()", () => {
  const withMark = () => {
    const calls: [string, string][] = []
    installContext({ mark: (n: string, v: string) => calls.push([n, v]) } as unknown as FlowContext)
    return calls
  }

  it("forwards name and value to the context", () => {
    const calls = withMark()
    mark("risk-tier", "high")
    mark("production-signal", "error rate")
    expect(calls).toEqual([
      ["risk-tier", "high"],
      ["production-signal", "error rate"],
    ])
  })

  it("throws the upgrade message on a context without mark, protocol still 1", () => {
    installContext(context)
    expect(() => mark("a", "b")).toThrow(
      "gtd: mark() needs a newer gtd — upgrade the gtd that runs it",
    )
    expect(FLOWS_PROTOCOL).toBe(1)
  })

  it.each(["", "Risk", "1a", "a_b", "-a", "risk-tier\n"])("rejects the name %j", (name) => {
    const calls = withMark()
    expect(() => mark(name, "v")).toThrow(/mark\(\)/)
    expect(calls).toEqual([])
  })

  it.each(["", " ", " x ", "x\t", "a\nGtd-Approved: {}", "a\rb", "a\u001bb", "a\u2028b", "high\n"])(
    "rejects the value %j",
    (value) => {
      const calls = withMark()
      expect(() => mark("risk-tier", value)).toThrow(/one line/)
      expect(calls).toEqual([])
    },
  )
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

/** A context that records every step request and resolves it with `reply`. */
const recording = (reply: unknown = undefined) => {
  const requests: StepRequest[] = []
  installContext({
    step: async (request: StepRequest) => {
      requests.push(request)
      return reply
    },
    vars: { greeting: "hi" },
    env: { testCommand: "npm test" },
  } as unknown as FlowContext)
  return requests
}

describe("human()", () => {
  it("takes its message positionally, the rest as options", async () => {
    const requests = recording()
    await human("gate", "Sign off.", { acceptClean: true })
    await human("plain", { message: "As before." })
    await human("bare")
    expect(requests.map((r) => (r.kind === "human" ? r.options : undefined))).toEqual([
      { acceptClean: true, message: "Sign off." },
      { message: "As before." },
      {},
    ])
  })

  it("types the positional form without a message option", () => {
    expectTypeOf(human).toBeCallableWith("gate", "Sign off.")
    expectTypeOf(human).toBeCallableWith("gate", { message: "m" } satisfies HumanOptions)
    // @ts-expect-error -- the message is positional in this form
    void (() => human("gate", "m", { message: "twice" }))
  })
})

describe("judge()", () => {
  const question = { id: "ok", instructions: "Is it?", criteria: "yes or no" } as const

  it("hands a yesno question on as noul, and passes file, mode and base through", async () => {
    const requests = recording({ answers: {}, truncated: [] })
    await judge("judging", {
      questions: [{ ...question, primitive: "yesno" }],
      evidence: { a: "b" },
      file: ".gtd/J.md",
      mode: "qa",
      base: "abc",
      label: "Judging",
    })
    expect(requests).toEqual([
      {
        kind: "judge",
        name: "judging",
        questions: [{ ...question, primitive: "noul" }],
        evidence: { a: "b" },
        options: { file: ".gtd/J.md", mode: "qa", base: "abc", label: "Judging" },
      },
    ])
  })

  it("keys the answers by the question ids, a computed id still readable", () => {
    const judged = () =>
      judge("j", {
        questions: [
          { ...question, primitive: "noul" },
          { ...question, id: "shape", primitive: "choice" },
        ],
        evidence: {},
      })
    expectTypeOf(judged).returns.resolves.toEqualTypeOf<Judgment<"ok" | "shape">>()
    expectTypeOf<Judgment<"ok">["answers"]>().toHaveProperty("ok")
    const computed = (j: Judgment<"ok">, id: string) => j.answers[id]
    expectTypeOf(computed).returns.toEqualTypeOf<
      { readonly answer: string; readonly p: number } | undefined
    >()
    expectTypeOf<Judgment<"ok">>().toMatchTypeOf<Judgment>()
  })
})

describe("settings", () => {
  it("are vars and env under the glossary's names", () => {
    recording()
    expect(settings).toBe(vars)
    expect(envSettings).toBe(env)
    expect(settings.greeting).toBe("hi")
    expect(envSettings.testCommand).toBe("npm test")
  })

  it("settingsOf() types the declared names, reading the same settings", () => {
    const defaults = { greeting: "hello" }
    const envDefaults = { testCommand: "npm test" }
    const typed = settingsOf(defaults)
    const typedEnv = envSettingsOf(envDefaults)
    recording()
    expect(typed.greeting).toBe("hi")
    expect(typedEnv.testCommand).toBe("npm test")
    expectTypeOf(typed.greeting).toEqualTypeOf<string>()
    expectTypeOf(typed).toEqualTypeOf<Settings<"greeting">>()
    // @ts-expect-error -- not a declared name
    void typed.greting
  })

  it("can be taken outside a replay, read inside one", () => {
    expect(() => settingsOf({ a: "" })).not.toThrow()
  })
})

describe("workflow()", () => {
  it("marks the very function it is given", () => {
    const flow = async (): Promise<void> => {}
    expect(isMarkedWorkflow(flow)).toBe(false)
    expect(workflow(flow)).toBe(flow)
    expect(isMarkedWorkflow(flow)).toBe(true)
    expect(isMarkedWorkflow(async () => {})).toBe(false)
    expect(isMarkedWorkflow({})).toBe(false)
  })
})

describe("mode", () => {
  it("names the built-in modes and still takes any string", () => {
    expectTypeOf<"qa">().toMatchTypeOf<ModeName>()
    expectTypeOf<string>().toMatchTypeOf<ModeName>()
    expectTypeOf<ModeName>().toMatchTypeOf<string>()
    expectTypeOf<SteeringOptions["mode"]>().toEqualTypeOf<ModeName | undefined>()
  })
})
