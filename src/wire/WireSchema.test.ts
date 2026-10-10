import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  BEAT_KINDS,
  beatDocument,
  demandOf,
  judgeJson,
  landFields,
  renderBeatJson,
  renderLandJson,
  statusOf,
  WIRE_SCHEMA,
  type BeatKind,
} from "./index.js"

const GOLDEN = resolve(import.meta.dirname, "golden")

// One golden set per schema. Removing or renaming a field bumps WIRE_SCHEMA
// and adds golden/<WIRE_SCHEMA>/ beside the old sets; adding a field needs
// neither. Only shape is compared, so reworded content never asks for a bump.
const DIR = resolve(GOLDEN, String(WIRE_SCHEMA))
const golden: ReadonlyMap<string, unknown> = new Map(
  readdirSync(DIR)
    .sort()
    .map((file) => [file, JSON.parse(readFileSync(resolve(DIR, file), "utf8"))]),
)

/** Every key path with its leaf type; `judge` is a JSON document carried as a string, so it is parsed first. */
const shape = (value: unknown, path = ""): string[] => {
  if (path === "judge" && typeof value === "string") return shape(JSON.parse(value), path)
  if (Array.isArray(value)) return value.flatMap((item) => shape(item, `${path}[]`))
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      shape(item, path ? `${path}.${key}` : key),
    )
  return [`${path}: ${value === null ? "null" : typeof value}`]
}

const missing = (actual: unknown, expected: unknown): string[] => {
  const has = new Set(shape(actual))
  return [...new Set(shape(expected))].filter((leaf) => !has.has(leaf))
}

const JUDGE = judgeJson({ diff: "…" }, [
  {
    id: "q1",
    primitive: "noul",
    instructions: "Is the change done?",
    criteria: "yes: every item ticked",
  },
])

const beat = (kind: BeatKind): string => {
  const rendered = {
    state: "build.fixing",
    actor: "agent",
    content: "fix it",
    model: "opus",
    system: "You are a careful senior engineer.",
    memory: "build#a1b2c3d",
    file: "TODO.md",
    mode: "qa",
    label: "Fixing",
    judge: JUDGE,
    skills: ["code-review"],
    access: { read: null, write: [".gtd/TODO.md"] },
  }
  const demand = demandOf(
    kind === "prompt"
      ? {
          rendered,
          kind,
          session: { id: "8f2c", resume: true },
          validate: "gtd check qa 'TODO.md'",
        }
      : { rendered, kind },
  )
  const status = statusOf({
    rendered,
    idle: false,
    initial: false,
    workflow: "feature",
    log: ".git/gtd-loop.log",
    changes: [{ status: "M", path: "TODO.md" }],
    next: { target: "idle" },
    cost: 12,
    costByModel: [{ model: "opus", cost: 12 }],
  })
  return renderBeatJson(beatDocument(demand, status))
}

const documents: Readonly<Record<string, string>> = {
  ...Object.fromEntries(BEAT_KINDS.map((kind) => [`beat-${kind}.json`, beat(kind)])),
  "land.json": renderLandJson(
    landFields({
      state: "build.review.closing",
      subject: "gtd(agent): build.fixing",
      cost: 0.42,
      model: "smart",
      script: "git commit ...\n",
      settled: false,
      idle: false,
    }),
  ),
  "land-noop.json": renderLandJson(
    landFields({
      state: "idle",
      subject: null,
      cost: null,
      model: null,
      script: "printf '%s\\n' 'nothing to do at \"idle\"'\n",
      settled: true,
      idle: true,
    }),
  ),
  "judge.json": JUDGE,
}

describe(`wire schema ${WIRE_SCHEMA}`, () => {
  it("the golden set covers every document kind", () => {
    expect([...golden.keys()]).toEqual(Object.keys(documents).sort())
  })

  for (const [file, json] of Object.entries(documents)) {
    it(`${file}: still emits every golden field under its name and type — removing or renaming one needs a WIRE_SCHEMA bump`, () => {
      expect(golden.get(file)).toHaveProperty("schema", WIRE_SCHEMA)
      expect(missing(JSON.parse(json), golden.get(file))).toEqual([])
    })
  }

  describe("the shape check", () => {
    const land = JSON.parse(documents["land.json"]!) as Record<string, unknown>
    const { subject, ...rest } = land

    it("reports a removed field", () => {
      expect(missing(rest, golden.get("land.json"))).toEqual(["subject: string"])
    })

    it("reports a renamed field", () => {
      expect(missing({ ...rest, title: subject }, golden.get("land.json"))).toEqual([
        "subject: string",
      ])
    })

    it("accepts an added field and changed content", () => {
      expect(missing({ ...land, extra: true, script: "other" }, golden.get("land.json"))).toEqual(
        [],
      )
    })

    it("reads inside the judge document a beat carries", () => {
      const beat = JSON.parse(documents["beat-message.json"]!) as Record<string, unknown>
      const judge = JSON.parse(beat.judge as string) as Record<string, unknown>
      const { state, ...withoutState } = judge
      expect(state).toBeDefined()
      expect(
        missing({ ...beat, judge: JSON.stringify(withoutState) }, golden.get("beat-message.json")),
      ).toEqual(["judge.state.diff: string"])
    })
  })
})
