import { Either } from "effect"
import { describe, expect, it } from "vitest"
import { resolveModel, resolveSettings, settingsPath } from "./Settings.js"

describe("settingsPath", () => {
  it("prefers $GTD_LOOP_CONFIG, then $XDG_CONFIG_HOME, then ~/.config", () => {
    const home = { HOME: "/h" }
    expect(settingsPath({ ...home, XDG_CONFIG_HOME: "/x", GTD_LOOP_CONFIG: "/c.json" })).toBe(
      "/c.json",
    )
    expect(settingsPath({ ...home, XDG_CONFIG_HOME: "/x" })).toBe("/x/gtd/loop.json")
    expect(settingsPath(home)).toBe("/h/.config/gtd/loop.json")
    expect(settingsPath({})).toBeUndefined()
  })
})

describe("resolveSettings / resolveModel", () => {
  const file = (json: unknown) => ({ path: "/loop.json", text: JSON.stringify(json) })
  const model = (
    env: Record<string, string>,
    json: unknown,
    hint: string | undefined,
  ): string | undefined =>
    Either.getOrThrow(
      Either.map(resolveSettings(env, json === undefined ? undefined : file(json)), (settings) =>
        resolveModel(settings, hint),
      ),
    )

  it("defaults to claude with the bundled hints mapped to its aliases", () => {
    expect(Either.map(resolveSettings({}, undefined), (s) => s.agent)).toEqual(
      Either.right("claude"),
    )
    expect(model({}, undefined, "smart")).toBe("opus")
    expect(model({}, undefined, "base")).toBe("sonnet")
  })

  it("gives pi no default models: an unmapped bundled hint is dropped", () => {
    const pi = { GTD_LOOP_AGENT: "pi" }
    expect(model(pi, undefined, "smart")).toBeUndefined()
    expect(model(pi, undefined, "base")).toBeUndefined()
    expect(model(pi, { models: { smart: "gpt-5" } }, "smart")).toBe("gpt-5")
    expect(model(pi, undefined, "gpt-5-mini")).toBe("gpt-5-mini")
  })

  it("passes an unmapped hint through, and no hint as none", () => {
    expect(model({}, undefined, "claude-haiku-4-5")).toBe("claude-haiku-4-5")
    expect(model({}, undefined, undefined)).toBeUndefined()
    expect(model({}, undefined, "")).toBeUndefined()
  })

  it("lets the environment win over the file, per key and per hint", () => {
    const env = { GTD_LOOP_AGENT: "claude", GTD_LOOP_MODEL_SMART: "fable" }
    const json = { agent: "pi", models: { smart: "opus-x", base: "sonnet-x" } }
    expect(Either.map(resolveSettings(env, file(json)), (s) => s.agent)).toEqual(
      Either.right("claude"),
    )
    expect(model(env, json, "smart")).toBe("fable")
    expect(model(env, json, "base")).toBe("sonnet-x")
  })

  it("names a hint with punctuation or capitals by its upper-cased, underscored form", () => {
    expect(model({ GTD_LOOP_MODEL_FAST_ONE: "haiku" }, undefined, "fast-one")).toBe("haiku")
    expect(model({ GTD_LOOP_MODEL_FAST_ONE: "haiku" }, undefined, "Fast.One")).toBe("haiku")
  })

  it("ignores an empty variable", () => {
    expect(model({ GTD_LOOP_AGENT: "", GTD_LOOP_MODEL_SMART: "" }, undefined, "smart")).toBe("opus")
  })

  it("refuses an unknown agent, an unknown key and a non-string model", () => {
    expect(Either.getLeft(resolveSettings({ GTD_LOOP_AGENT: "codex" }, undefined))).toEqual(
      expect.objectContaining({ value: 'GTD_LOOP_AGENT must be "claude" or "pi" — got "codex"' }),
    )
    expect(Either.isLeft(resolveSettings({}, file({ agents: "pi" })))).toBe(true)
    expect(Either.isLeft(resolveSettings({}, file({ models: { smart: 1 } })))).toBe(true)
  })
})
