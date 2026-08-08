import { JSONSchema } from "effect"
import { describe, expect, it } from "vitest"
import { ConfigSchema } from "./ConfigSchema.js"
import { STATE_FIELD_ENTRIES } from "./StateFields.js"

/**
 * The file whose absence let the `answerGate` bug ship: `stateJsonSchema`
 * (the editor autocompletion schema `scripts/generate-schema.ts` publishes)
 * had no test, so it silently missed a state property for ten commits.
 * `stateJsonSchema`'s `properties` is now DERIVED from `STATE_FIELD_ENTRIES`,
 * so this test pins the derivation's contract rather than a hand-maintained
 * enumeration.
 */

type JsonObject = Record<string, unknown>

const isJsonObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null

/** Navigate from the full generated schema down to `stateJsonSchema`'s compiled shape. */
const stateSchemaOf = (schema: JsonObject): JsonObject => {
  const workflow = schema["properties"]
  if (!isJsonObject(workflow)) throw new Error("no top-level properties")
  const workflowProp = workflow["workflow"]
  if (!isJsonObject(workflowProp)) throw new Error("no workflow property")
  const machines = (workflowProp["properties"] as JsonObject)["machines"]
  if (!isJsonObject(machines)) throw new Error("no machines property")
  const machine = machines["additionalProperties"]
  if (!isJsonObject(machine)) throw new Error("no machine shape")
  const states = (machine["properties"] as JsonObject)["states"]
  if (!isJsonObject(states)) throw new Error("no states property")
  const stateOrRef = states["additionalProperties"]
  if (!isJsonObject(stateOrRef)) throw new Error("no state/ref oneOf")
  const [state] = stateOrRef["oneOf"] as JsonObject[]
  if (!isJsonObject(state)) throw new Error("no state schema")
  return state
}

const buildStateSchema = (): JsonObject =>
  stateSchemaOf(JSONSchema.make(ConfigSchema) as unknown as JsonObject)

const AUTHORED_STATE_KEYS = STATE_FIELD_ENTRIES.filter(([, spec]) => spec.authored === "state").map(
  ([key]) => key,
)

describe("ConfigSchema — stateJsonSchema derives from STATE_FIELD_ENTRIES", () => {
  it("has exactly the authored: state field keys, in table order", () => {
    const state = buildStateSchema()
    expect(Object.keys(state["properties"] as JsonObject)).toEqual(AUTHORED_STATE_KEYS)
  })

  it("excludes model — authored: machine, stamped by the owning machine, never by a state", () => {
    const state = buildStateSchema()
    expect(state["properties"]).not.toHaveProperty("model")
  })

  it("every property carries a non-empty description", () => {
    const state = buildStateSchema()
    const properties = state["properties"] as Record<string, JsonObject>
    for (const [key, prop] of Object.entries(properties)) {
      expect(typeof prop["description"], `property "${key}"`).toBe("string")
      expect((prop["description"] as string).length, `property "${key}"`).toBeGreaterThan(0)
    }
  })

  it("keeps `on`'s nested oneOf/additionalProperties shape (the jsonSchema escape hatch)", () => {
    const state = buildStateSchema()
    const on = (state["properties"] as JsonObject)["on"] as JsonObject
    const additionalProperties = on["additionalProperties"] as JsonObject
    expect(Array.isArray(additionalProperties["oneOf"])).toBe(true)
    const objectForm = (additionalProperties["oneOf"] as JsonObject[])[1]!
    expect(objectForm["required"]).toEqual(["to"])
    expect(objectForm["additionalProperties"]).toBe(false)
  })

  it("keeps `retry`'s nested required/additionalProperties shape (the jsonSchema escape hatch)", () => {
    const state = buildStateSchema()
    const retry = (state["properties"] as JsonObject)["retry"] as JsonObject
    expect(retry["required"]).toEqual(["max", "otherwise"])
    expect(retry["additionalProperties"]).toBe(false)
  })
})
