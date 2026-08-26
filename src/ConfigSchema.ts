import { Schema } from "effect"
import { MACHINE_FIELD_ENTRIES, STATE_FIELD_ENTRIES, type FieldKind } from "./StateFields.js"

/** The `vars:` shape (top-level AND inside `workflow:`): a flat name -> scalar map (`compileVarsMap` coerces every scalar to a string). */
const varsJsonSchema = {
  type: "object",
  description:
    "Flat name -> scalar map merged into every template's it.vars. Scalars are coerced to strings.",
  additionalProperties: { type: ["string", "number", "boolean"] },
} as const

/** The `modes:` shape (top-level AND inside `workflow:`): mode name -> its format/validate shell commands (`compileModesMap`). */
const modesJsonSchema = {
  type: "object",
  description:
    "Steering-file modes a state's mode: may name. Each entry declares at least one of format/validate: shell commands (Eta templates seeing it.file = the rendered steering-file path) gtd runs via bash. format rewrites the file in place; validate exits 0 when valid, non-zero with findings on stdout/stderr otherwise. The halves layer independently, so naming a built-in mode (qa/review) and declaring only format: adds formatting while keeping gtd's own validation. gtd ships no formatter — bring your own (prettier, dprint, a script).",
  additionalProperties: {
    type: "object",
    description: "One mode: at least one of format/validate.",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      format: {
        type: "string",
        description:
          "Shell command that rewrites the steering file in place before validation (Eta template; it.file is the file path). A non-zero exit is a hard error.",
      },
      validate: {
        type: "string",
        description:
          "Shell command that validates the steering file (Eta template; it.file is the file path). Exit 0 = valid; non-zero = invalid, with its output reported as the findings.",
      },
    },
  },
} as const

/**
 * Every `FieldKind` -> its plain JSON Schema type shape. The escape hatch
 * (`FieldSpec.jsonSchema`) covers the two structurally-nested kinds (`edges`,
 * `retry`) — their entries here are unreachable filler, kept only so this
 * stays a total `Record<FieldKind, object>`: the exhaustiveness guard that
 * makes a new `FieldKind` fail to compile here (and in `PatternConfig.ts`'s
 * `COMPILE`) until it's given a shape.
 */
const JSON_TYPE: Record<FieldKind, object> = {
  actor: { type: "string" },
  text: { type: "string" },
  stateFile: { type: "string" },
  mode: { type: "string" },
  content: { type: "string" },
  flag: { type: "boolean" },
  flagOrTemplate: { oneOf: [{ const: true }, { type: "string" }] },
  edges: { type: "object" },
  retry: { type: "object" },
}

/** One state's shape — `properties` is derived from `STATE_FIELD_ENTRIES` (every `authored: "state"` field, in table order); see `ConfigSchema.test.ts`. */
const stateJsonSchema = {
  type: "object",
  description: "One workflow state. Declare exactly one content kind (script/prompt/message).",
  additionalProperties: false,
  properties: Object.fromEntries(
    STATE_FIELD_ENTRIES.filter(([, spec]) => spec.authored === "state").map(([key, spec]) => [
      key,
      spec.jsonSchema ?? { ...JSON_TYPE[spec.kind], description: spec.doc },
    ]),
  ),
} as const

/** A reference local: instantiates a declared machine as a child, optionally binding its `params:` — mirrors `Machines.ts`'s `isRef`. */
const machineRefJsonSchema = {
  type: "object",
  description:
    "A reference: instantiates the named machine as a child, at this local's path (see src/Machines.ts). Expanded at load time into concrete, qualified states — the engine only ever sees the flattened result.",
  additionalProperties: false,
  required: ["machine"],
  properties: {
    machine: { type: "string", description: "Name of a declared entry in `machines:`." },
    with: {
      type: "object",
      description:
        "Bindings for the referenced machine's `params:`. A bound value naming another of the CALLER's own bindings (a whole-value `$name`) passes it down verbatim, scope intact.",
    },
  },
} as const

/** One machine definition — mirrors `Machines.ts`'s `RawMachine`. */
const machineJsonSchema = {
  type: "object",
  description:
    "A named, reusable machine: an entry local plus a set of states, each either an ordinary state or a reference instantiating another machine as a child (see src/Machines.ts).",
  additionalProperties: false,
  required: ["entry", "states"],
  properties: {
    params: {
      type: "array",
      items: { type: "string" },
      description:
        "Advisory only — documents which $params a caller may bind via a reference's `with:`. A `$name` token used as a whole field value or `on`/`retry.otherwise` target is resolved against the binding.",
    },
    entry: {
      type: "string",
      description:
        "This machine's own default local (a local state name, or a reference key), resolved recursively.",
    },
    ...Object.fromEntries(
      MACHINE_FIELD_ENTRIES.map(([key, spec]) => [
        key,
        spec.jsonSchema ?? { ...JSON_TYPE[spec.kind], description: spec.doc },
      ]),
    ),
    states: {
      type: "object",
      description:
        "This machine's local states, each either an ordinary state or a `{ machine, with }` reference.",
      minProperties: 1,
      additionalProperties: {
        oneOf: [stateJsonSchema, machineRefJsonSchema],
      },
    },
  },
} as const

/** The top-level `entry:` value — which machine is the root instance. */
const entryJsonSchema = {
  type: "object",
  description:
    "The workflow's root machine, resolved through the same resolver an `on`/`retry.otherwise` target uses (see src/Machines.ts) — accepts either a bare state path or an instance/reference-key path. Extra manual entry points are declared per-state instead, via a state's own `entry: true` (see `stateJsonSchema`'s `entry` property) — not here.",
  additionalProperties: false,
  required: ["default"],
  properties: {
    default: {
      type: "string",
      description: "Which declared `machines:` entry is the ROOT instance.",
    },
  },
} as const

/** The top-level `summary:` value — the `gtd summary` prompt template. */
const summaryJsonSchema = {
  type: "string",
  description:
    "Eta template rendered by `gtd summary`: instructions plus commit hashes (it.entryCommit, it.humanCommits, it.processBase, it.processTip) for an agent to write the process's own closing message. A ./ or ../ value is inlined from the config file's directory at load time. Absent is legal (gtd summary refuses); present-but-blank is a load error.",
} as const

/** The whole `workflow:` value; `PatternConfig.ts`'s compiler is the authoritative schema, this is the editor's first net. */
const workflowJsonSchema = {
  type: "object",
  description:
    "The whole machine definition: a tree of named machines rooted at entry.default (plus the workflow's own vars: defaults, modes: steering-file modes, and summary: template). Compiled and validated by gtd at load time; content strings starting with ./ or ../ are file references inlined from the config file's directory (a modes: command never is — it is a shell command).",
  additionalProperties: false,
  required: ["entry", "machines"],
  properties: {
    vars: varsJsonSchema,
    modes: modesJsonSchema,
    summary: summaryJsonSchema,
    entry: entryJsonSchema,
    machines: {
      type: "object",
      description: "Named, reusable machines — at least the one entry.default names.",
      minProperties: 1,
      additionalProperties: machineJsonSchema,
    },
  },
} as const

export const ConfigSchema = Schema.Struct({
  workflow: Schema.optional(Schema.Unknown.annotations({ jsonSchema: workflowJsonSchema })),
  vars: Schema.optional(Schema.Unknown.annotations({ jsonSchema: varsJsonSchema })),
  modes: Schema.optional(Schema.Unknown.annotations({ jsonSchema: modesJsonSchema })),
})

export type DecodedConfig = Schema.Schema.Type<typeof ConfigSchema>
