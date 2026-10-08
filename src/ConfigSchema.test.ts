import { JSONSchema, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ConfigSchema } from "./ConfigSchema.js"

type JsonObject = Record<string, unknown>

describe("ConfigSchema — the published shape", () => {
  it("publishes vars, env, judge, modes, ui, skills and access", () => {
    const schema = JSONSchema.make(ConfigSchema) as unknown as JsonObject
    const properties = schema["properties"] as JsonObject
    expect(Object.keys(properties)).toEqual([
      "vars",
      "env",
      "judge",
      "modes",
      "ui",
      "skills",
      "access",
    ])
  })
})

describe("ConfigSchema — top-level `ui:`", () => {
  const decode = (input: unknown) =>
    Schema.decodeUnknownSync(ConfigSchema)(input, { onExcessProperty: "error" })

  it("decodes with `ui:` absent", () => {
    expect(decode({}).ui).toBeUndefined()
  })

  it("decodes with every sub-key present", () => {
    const input = {
      ui: {
        port: 4173,
        host: "0.0.0.0",
        cert: "./certs/server.crt",
        key: "./certs/server.key",
        format: "npx oxfmt --write $GTD_FILE",
      },
    }
    expect(decode(input).ui).toEqual(input.ui)
  })

  it.each(["port", "host", "cert", "key", "format"] as const)(
    "decodes with only `%s` present",
    (key) => {
      const value = key === "port" ? 4173 : "x"
      const cfg = decode({ ui: { [key]: value } })
      expect(cfg.ui).toEqual({ [key]: value })
    },
  )

  it("rejects an unknown sub-key under `ui:` as an excess property", () => {
    expect(() => decode({ ui: { bogus: true } })).toThrow()
  })

  it("rejects `ui.loop` as an excess property", () => {
    expect(() => decode({ ui: { loop: "gtd next --json" } })).toThrow()
  })

  it("rejects `ui.roots` as an excess property", () => {
    expect(() => decode({ ui: { roots: ["/repo"] } })).toThrow()
  })

  it("rejects a non-integer `port`", () => {
    expect(() => decode({ ui: { port: "not-a-number" } })).toThrow()
  })

  it("publishes the hand-written `uiJsonSchema` literal, with a non-empty description and one per property", () => {
    const schema = JSONSchema.make(ConfigSchema) as unknown as JsonObject
    const ui = (schema["properties"] as JsonObject)["ui"] as JsonObject
    expect(typeof ui["description"]).toBe("string")
    expect((ui["description"] as string).length).toBeGreaterThan(0)
    const properties = ui["properties"] as Record<string, JsonObject>
    expect(Object.keys(properties)).toEqual(["port", "host", "cert", "key", "format"])
    for (const [key, prop] of Object.entries(properties)) {
      expect(typeof prop["description"], `property "${key}"`).toBe("string")
      expect((prop["description"] as string).length, `property "${key}"`).toBeGreaterThan(0)
    }
  })
})

describe("ConfigSchema — top-level `judge:`", () => {
  const decode = (input: unknown) =>
    Schema.decodeUnknownSync(ConfigSchema)(input, { onExcessProperty: "error" })

  it("decodes a provider and a model", () => {
    expect(decode({ judge: { provider: "llm", model: "haiku" } }).judge).toEqual({
      provider: "llm",
      model: "haiku",
    })
  })

  it("rejects an unknown key", () => {
    expect(() => decode({ judge: { speed: "fast" } })).toThrow()
  })

  it("rejects a provider outside fixed|jev|llm", () => {
    expect(() => decode({ judge: { provider: "gpt" } })).toThrow()
  })

  it("accepts `env:` as an open scalar map", () => {
    expect(decode({ env: { testCommand: "make test" } }).env).toEqual({
      testCommand: "make test",
    })
  })
})
