import { Schema } from "effect"

/** The `vars:` shape: a flat name -> scalar map (`compileVarsMap` coerces every scalar to a string). */
const varsJsonSchema = {
  type: "object",
  description:
    "Flat name -> scalar map merged into the workflow's process settings (defaults), pinned for the whole process at its start. Scalars are coerced to strings.",
  additionalProperties: { type: ["string", "number", "boolean"] },
} as const

/** The `env:` shape: environment settings, read live on every invocation and never pinned to a process. */
const envJsonSchema = {
  type: "object",
  description:
    "Flat name -> scalar map merged into the workflow's environment settings (envDefaults) — values that change how a step runs on this machine, like the test command or a model hint. Read fresh on every gtd call, never pinned to a process. GTD_<NAME> environment variables override these entries. Scalars are coerced to strings.",
  additionalProperties: { type: ["string", "number", "boolean"] },
} as const

/** The `modes:` shape: mode name -> its format/validate shell commands (`compileModesMap`). */
const modesJsonSchema = {
  type: "object",
  description:
    "Steering-file modes a workflow step's mode: may name. Each entry declares at least one of format/validate: shell commands gtd runs via bash with $GTD_FILE set to the steering file's path. format rewrites the file in place; validate exits 0 when valid, non-zero with findings on stdout/stderr otherwise. The halves layer independently, so naming a built-in mode (qa/review) and declaring only format: adds formatting while keeping gtd's own validation. gtd ships no formatter — bring your own (prettier, dprint, a script).",
  additionalProperties: {
    type: "object",
    description: "One mode: at least one of format/validate.",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      format: {
        type: "string",
        description:
          "Shell command that rewrites the steering file in place before validation ($GTD_FILE is the file path). A non-zero exit is a hard error.",
      },
      validate: {
        type: "string",
        description:
          "Shell command that validates the steering file ($GTD_FILE is the file path). Exit 0 = valid; non-zero = invalid, with its output reported as the findings.",
      },
    },
  },
} as const

/** The `skills:` shape: full step name -> its skill list (`compileSkillsMap`). An entry REPLACES the step's bundled list wholesale, never adds to it — and the schema can validate an entry's VALUE but never its KEY, since step names come from the workflow in play, not a fixed set. */
const skillsJsonSchema = {
  type: "object",
  description:
    "Flat step full-name -> skill-name array map. Each entry REPLACES the named step's bundled skill list wholesale (never merges into it); [] means no skills at all for that step, and no preamble. A key naming a step the workflow in play does not declare is a load error listing the known names — the schema itself cannot validate a key, only a value's shape.",
  additionalProperties: { type: "array", items: { type: "string" } },
} as const

/**
 * A real (not `Unknown`) schema, unlike `vars`/`modes`: it is a flat settings
 * struct with no per-mode map to compile, so its JSON Schema derives from the
 * `description` annotations below and an excess sub-key is rejected by the
 * `onExcessProperty: "error"` decode option `Config.ts` already passes.
 *
 * That rejection exits 1 (`EXIT_RUNTIME_ERROR`), like every other config
 * decode failure — a `ui:`-only exit 2 would be the one config error in the
 * CLI a user could not infer.
 */
const UiSchema = Schema.Struct({
  port: Schema.optional(
    Schema.Int.annotations({
      description:
        "For ui, the tailscale serve port (default: the first free of 8443, 10000, 443), or the bind port when --host opts out of serve (default: a free port).",
    }),
  ),
  host: Schema.optional(
    Schema.String.annotations({ description: "Host/interface `gtd ui` binds to." }),
  ),
  cert: Schema.optional(
    Schema.String.annotations({
      description: "Path to a TLS certificate file, enabling HTTPS. Requires `key` too.",
    }),
  ),
  key: Schema.optional(
    Schema.String.annotations({
      description: "Path to a TLS private key file, enabling HTTPS. Requires `cert` too.",
    }),
  ),
  format: Schema.optional(
    Schema.String.annotations({
      description:
        "Shell command run after every UI write, before it resolves ($GTD_FILE is the written file's absolute path). A non-zero exit or missing binary never reverts the write or refuses it — it's reported to the client as a notice naming the command and its exit code. Absent means no command runs at all.",
    }),
  ),
}).annotations({ description: "Settings for `gtd ui`: where it listens, and optional TLS." })

const JudgeSchema = Schema.Struct({
  provider: Schema.optional(
    Schema.Literal("fixed", "jev", "llm").annotations({
      description:
        "Judge provider `gtd judge run` uses when no --provider flag and no GTD_JUDGE_PROVIDER is set. Absent means auto: jev when TYPESAFE_API_KEY is set, otherwise llm.",
    }),
  ),
  model: Schema.optional(
    Schema.String.annotations({
      description:
        "Model for provider llm, used when no --model flag and no GTD_JUDGE_MODEL is set. Pairing it with another provider is an error.",
    }),
  ),
}).annotations({
  description: "Which judge `gtd judge run` uses, when no flag or GTD_JUDGE_* variable says.",
})

export const ConfigSchema = Schema.Struct({
  vars: Schema.optional(Schema.Unknown.annotations({ jsonSchema: varsJsonSchema })),
  env: Schema.optional(Schema.Unknown.annotations({ jsonSchema: envJsonSchema })),
  judge: Schema.optional(JudgeSchema),
  modes: Schema.optional(Schema.Unknown.annotations({ jsonSchema: modesJsonSchema })),
  ui: Schema.optional(UiSchema),
  skills: Schema.optional(Schema.Unknown.annotations({ jsonSchema: skillsJsonSchema })),
})

export type JudgeConfig = Schema.Schema.Type<typeof JudgeSchema>

/** The decoded `ui:` shape — `gtd ui` and its CLI flags read `port`/`host`/`cert`/`key` off this. */
export type UiConfig = Schema.Schema.Type<typeof UiSchema>
