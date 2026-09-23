import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  CONTENT_FIELDS,
  MACHINE_FIELD_ENTRIES,
  STATE_FIELD_ENTRIES,
  validateFieldRules,
  type StateDef,
} from "./StateFields.js"

describe("StateFields — zero-import leaf", () => {
  it("declares no import statement other than a type-only import of its own vocabulary back from src/wire/", () => {
    const source = readFileSync(fileURLToPath(new URL("./StateFields.ts", import.meta.url)), "utf8")
    const importLines = source.match(/^\s*import\b.*$/gm) ?? []
    for (const line of importLines) {
      expect(line).toMatch(/^import type \{[^}]*\} from "\.\/wire\/index\.js"$/)
    }
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

describe("STATE_FIELD_ENTRIES — every state-authored key is documented in docs/configuration.md", () => {
  // `docs/configuration.md`'s state-shape ```yaml block is the canonical,
  // exhaustive-looking reference a user reads — per AGENTS.md, a config key
  // is exactly what documentation exists to state. This pins the reference
  // against `STATE_FIELDS` itself, so a new state-authored field (or a
  // rename) fails HERE instead of shipping silently undocumented — package
  // 01's round-2 review item 7 found `judge:`/`routes:`/`shadow:` absent.
  it('names every key with authored: "state" (actor/on/retry/.../judge/routes/shadow) in the state-shape block', () => {
    const doc = readFileSync(
      fileURLToPath(new URL("../docs/configuration.md", import.meta.url)),
      "utf8",
    )
    const block = doc.match(/```yaml\nworkflow:\n([\s\S]*?)\n```/)
    expect(block).not.toBeNull()
    const shapeBlock = block![1]!
    const stateAuthoredKeys = STATE_FIELD_ENTRIES.filter(
      ([, spec]) => spec.authored === "state",
    ).map(([key]) => key)
    expect(stateAuthoredKeys.length).toBeGreaterThan(0)
    for (const key of stateAuthoredKeys) {
      expect(shapeBlock).toMatch(new RegExp(`\\n\\s*${key}:`))
    }
  })
})

describe("judge/shadow — requires chain", () => {
  it("judge requires message", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "judge")![1]
    expect(spec.requires).toBe("message")
  })

  it("shadow requires judge", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "shadow")![1]
    expect(spec.requires).toBe("judge")
  })
})

describe("routes — requires chain", () => {
  it("routes requires judge", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "routes")![1]
    expect(spec.requires).toBe("judge")
  })
})

describe("skills", () => {
  it("declares exactly kind/surface/authored/nonEmpty/requires/rest/viz plus doc — no jsonSchema escape hatch", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "skills")![1]
    expect(Object.keys(spec).sort()).toEqual(
      ["authored", "doc", "kind", "nonEmpty", "requires", "rest", "surface", "viz"].sort(),
    )
    expect(spec.kind).toBe("text")
    expect(spec.surface).toBe("def")
    expect(spec.authored).toBe("state")
    expect(spec.nonEmpty).toBe(true)
    expect(spec.requires).toBe("prompt")
    expect(spec.rest).toBe("rendered")
    expect(spec.viz).toBe("field")
  })

  it("its doc states both facts: a literal empty string is rejected at load, a blank RENDER is legal", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "skills")![1]
    expect(spec.doc).toMatch(/rejected at load/)
    expect(spec.doc).toMatch(/RENDERS? blank is legal|renders blank is legal/i)
  })

  it("is rejected without a sibling prompt:", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "skills")![1]
    expect(validateFieldRules("build.fixing", { skills: "code-review" }, "skills", spec)).toEqual([
      'state "build.fixing": "skills" requires "prompt"',
    ])
  })

  it("passes when a sibling prompt: is declared", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "skills")![1]
    expect(
      validateFieldRules(
        "build.fixing",
        { skills: "code-review", prompt: "fix it" },
        "skills",
        spec,
      ),
    ).toEqual([])
  })

  it("rejects a literal empty string at load", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "skills")![1]
    expect(validateFieldRules("build.fixing", { skills: "" }, "skills", spec)).toEqual([
      'state "build.fixing": "skills" must be a non-empty string',
      'state "build.fixing": "skills" requires "prompt"',
    ])
  })
})

describe("CONTENT_FIELDS", () => {
  it("is exactly script/prompt/message, in that order", () => {
    expect(CONTENT_FIELDS).toEqual(["script", "prompt", "message"])
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

  it("flags a field missing the sibling it requires", () => {
    const spec = STATE_FIELD_ENTRIES.find(([k]) => k === "mode")![1]
    expect(validateFieldRules("a", { mode: "qa" }, "mode", spec)).toEqual([
      'state "a": "mode" requires "file"',
    ])
  })

  it("runs nonEmpty, requires in that order for one field", () => {
    const spec = {
      kind: "text",
      surface: "def",
      authored: "state",
      nonEmpty: true,
      requires: "file",
      doc: "",
    } as const
    expect(validateFieldRules("a", { model: "" } as unknown as StateDef, "model", spec)).toEqual([
      'state "a": "model" must be a non-empty string',
      'state "a": "model" requires "file"',
    ])
  })
})
