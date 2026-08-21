import { Schema } from "effect"
import { MACHINE_FIELD_ENTRIES, STATE_FIELD_ENTRIES, type FieldKind } from "./StateFields.js"

/**
 * v3's `.gtdrc` config shape: three blessed top-level keys — `workflow:` (the
 * whole machine definition, compiled by `./PatternConfig.js`), `vars:` (a
 * flat `name -> scalar` map, one of the three layers merged into every
 * template's `it.vars` — see `./Config.js`'s `toOperations` and
 * `./Edge.js`'s `resolveVars`), and `modes:` (steering-file modes layered over
 * the active workflow's own `modes:` and gtd's built-in validators, so a
 * project can plug its formatter into the BUNDLED default without re-declaring
 * the workflow). There are no other blessed config keys (see `./Config.js`'s
 * module docstring for why).
 *
 * All three keys decode as `Schema.Unknown`: the shape is validated structurally
 * by the workflow compiler (`src/PatternConfig.ts`), not by effect/schema —
 * the shape is deep and recursive, and the compiler's errors carry rule
 * coordinates a flat schema error cannot. The `jsonSchema` ANNOTATIONS below
 * exist for one consumer only: `scripts/generate-schema.ts`, which publishes
 * `schema.json` for editor-side autocompletion/validation
 * (yaml-language-server et al). They describe the same shape the compiler
 * enforces, minus the rules JSON Schema cannot express (exactly one content
 * kind per state, exactly one `initial: true` across the workflow, `on`/
 * `retry.otherwise` targets naming defined states, reachability) — the
 * compiler stays the source of truth; the annotation is the editor's first
 * net, never a second validator to keep behaviorally in sync.
 *
 * `stateJsonSchema`'s `properties` is DERIVED from `src/StateFields.ts`'s
 * `STATE_FIELD_ENTRIES` (every field whose `authored` is `"state"`, in table
 * order) rather than hand-listed — this is the fix for the bug that motivated
 * `STATE_FIELDS` existing at all: `answerGate` shipped ten commits without
 * ever being added here (this module had no test), silently rejecting valid
 * configs. A new state property is now automatically part of this schema the
 * moment it's added to the table; `ConfigSchema.test.ts` asserts the derived
 * property set stays exactly the `authored: "state"` keys.
 *
 * Kept in its own module, separate from `./Config.js`, so `scripts/generate-
 * schema.ts` (run via `jiti`, a plain TS-via-Babel loader with no bundler-
 * style pluggable per-extension loaders) can import JUST the schema without
 * risking a transitive pull into the bundled workflow templates
 * (`./workflows/templates.js`, which imports `unified.yaml` as
 * raw text via tsdown's/vitest's `.yaml`-as-text loader — something `jiti` has
 * no equivalent for and doesn't need here): the schema shape never depends on
 * any workflow's content.
 */

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
  description:
    "One workflow state. Declare exactly one content kind (script/prompt/message/commit). A commit state is final: no actor, no on.",
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

/** The whole `workflow:` value — see `PatternConfig.ts`'s module docstring for the authoritative schema. */
const workflowJsonSchema = {
  type: "object",
  description:
    "The whole machine definition: a tree of named machines rooted at entry.default (plus the workflow's own vars: defaults and modes: steering-file modes). Compiled and validated by gtd at load time; content strings starting with ./ or ../ are file references inlined from the config file's directory (a modes: command never is — it is a shell command).",
  additionalProperties: false,
  required: ["entry", "machines"],
  properties: {
    vars: varsJsonSchema,
    modes: modesJsonSchema,
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
