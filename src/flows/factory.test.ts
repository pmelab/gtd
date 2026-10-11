import type { StandardSchemaV1 } from "@standard-schema/spec"
import { describe, expect, it } from "vitest"
import { configure, defineWorkflow, isFactoryWorkflow } from "./factory.js"

// A hand-written Standard Schema: `{ greeting?: string }`, unknown keys rejected.
const greetingSchema: StandardSchemaV1<{ greeting?: string }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      const issues: StandardSchemaV1.Issue[] = []
      for (const [key, v] of Object.entries(value as object)) {
        if (key !== "greeting") issues.push({ message: "is unexpected", path: [key] })
        else if (typeof v !== "string") issues.push({ message: "Expected string", path: [{ key }] })
      }
      return issues.length > 0 ? { issues } : { value: value as { greeting?: string } }
    },
  },
}

const flow = async (): Promise<void> => {}
const greeter = defineWorkflow(greetingSchema, (options) => ({
  flow,
  defaults: { greeting: options.greeting ?? "hello" },
}))

describe("defineWorkflow", () => {
  it("marks the factory and a call's result as factory workflows, a plain flow not", () => {
    expect(isFactoryWorkflow(greeter)).toBe(true)
    expect(isFactoryWorkflow(greeter({ greeting: "hi" }))).toBe(true)
    expect(isFactoryWorkflow(flow)).toBe(false)
    expect(configure(flow)).toBeUndefined()
  })

  it("builds the factory itself with no options", () => {
    expect(configure(greeter)).toEqual({
      ok: true,
      build: { flow, defaults: { greeting: "hello" } },
    })
  })

  it("builds a call's result from the options it was called with", () => {
    expect(configure(greeter({ greeting: "hi" }))).toEqual({
      ok: true,
      build: { flow, defaults: { greeting: "hi" } },
    })
  })

  it("lays overrides over the options a call was given", () => {
    expect(configure(greeter({ greeting: "hi" }), { greeting: "hey" })).toEqual({
      ok: true,
      build: { flow, defaults: { greeting: "hey" } },
    })
  })

  it("reports every issue with its key path, path segments flattened", () => {
    const bad = greeter({ greeting: 1 } as never)
    expect(configure(bad, { greting: "x" })).toEqual({
      ok: false,
      issues: [
        { path: ["greeting"], message: "Expected string" },
        { path: ["greting"], message: "is unexpected" },
      ],
    })
  })

  it("refuses a schema that validates asynchronously", () => {
    const asyncSchema: StandardSchemaV1<object> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async (value) => ({ value: value as object }),
      },
    }
    const result = configure(defineWorkflow(asyncSchema, () => ({ flow })))
    expect(result).toMatchObject({ ok: false, issues: [{ path: [] }] })
  })

  it("treats a schema failing with no issues as a rejection", () => {
    const empty: StandardSchemaV1<object> = {
      "~standard": { version: 1, vendor: "test", validate: () => ({ issues: [] }) },
    }
    expect(configure(defineWorkflow(empty, () => ({ flow })))).toMatchObject({
      ok: false,
      issues: [{ path: [] }],
    })
  })

  it("throws when a call's result is awaited as if it were a flow", async () => {
    await expect(Promise.resolve(greeter() as unknown as PromiseLike<void>)).rejects.toThrow(
      /not a flow/,
    )
  })
})
