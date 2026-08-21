import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  CONTENT_FIELDS,
  MACHINE_FIELD_ENTRIES,
  STATE_FIELD_ENTRIES,
  isCommitState,
  validateFieldRules,
  type StateDef,
} from "./StateFields.js"

describe("StateFields — zero-import leaf", () => {
  it("declares no import statement", () => {
    const source = readFileSync(fileURLToPath(new URL("./StateFields.ts", import.meta.url)), "utf8")
    expect(source).not.toMatch(/^\s*import\b/m)
  })
})

describe("STATE_FIELD_ENTRIES", () => {
  it("every `requires` names a real field in the table", () => {
    const names = new Set<string>(STATE_FIELD_ENTRIES.map(([key]) => key))
    for (const [, spec] of STATE_FIELD_ENTRIES) {
      if (spec.requires !== undefined) expect(names.has(spec.requires)).toBe(true)
    }
  })
})

describe("CONTENT_FIELDS", () => {
  it("is exactly script/prompt/message/commit, in that order", () => {
    expect(CONTENT_FIELDS).toEqual(["script", "prompt", "message", "commit"])
  })
})

describe("MACHINE_FIELD_ENTRIES", () => {
  it("is exactly model then system, in table order", () => {
    expect(MACHINE_FIELD_ENTRIES.map(([key]) => key)).toEqual(["model", "system"])
  })
})

describe("StateDef — surface: authoring-only fields are absent from the compiled type", () => {
  it("`entry` is not a key of StateDef (type-level assertion)", () => {
    type HasEntry = "entry" extends keyof StateDef ? "present" : "absent"
    const check = "absent" satisfies HasEntry
    expect(check).toBe("absent")
  })
})

describe("isCommitState", () => {
  it("is true only when `commit` is set", () => {
    expect(isCommitState({ commit: "chore: x" })).toBe(true)
    expect(isCommitState({ actor: "human", message: "hi" })).toBe(false)
  })
})

describe("validateFieldRules", () => {
  it("returns nothing when the field is absent", () => {
    expect(
      validateFieldRules("a", {}, "model", STATE_FIELD_ENTRIES.find(([k]) => k === "model")![1]),
    ).toEqual([])
  })

  it("flags an empty non-empty-required field", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "label")![1]
    expect(validateFieldRules("a", { label: "" }, "label", spec)).toEqual([
      'state "a": "label" must be a non-empty string',
    ])
  })

  it("flags a forbidden-on-commit field declared on a commit state", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "model")![1]
    expect(validateFieldRules("a", { commit: "chore: x", model: "smart" }, "model", spec)).toEqual([
      'state "a": a commit state cannot declare "model"',
    ])
  })

  it("flags a field missing the sibling it requires", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "mode")![1]
    expect(validateFieldRules("a", { mode: "qa" }, "mode", spec)).toEqual([
      'state "a": "mode" requires "file"',
    ])
  })

  it("runs nonEmpty, commit, requires in that order for one field", () => {
    const spec = {
      kind: "text",
      surface: "def",
      authored: "state",
      nonEmpty: true,
      commit: "forbidden",
      requires: "file",
      doc: "",
    } as const
    expect(
      validateFieldRules(
        "a",
        { commit: "chore: x", model: "" } as unknown as StateDef,
        "model",
        spec,
      ),
    ).toEqual([
      'state "a": "model" must be a non-empty string',
      'state "a": a commit state cannot declare "model"',
      'state "a": "model" requires "file"',
    ])
  })
})
