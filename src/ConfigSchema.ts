import { Schema } from "effect"

/** The `vars:` shape: a flat name -> scalar map (`compileVarsMap` coerces every scalar to a string). */
const varsJsonSchema = {
  type: "object",
  description:
    "Flat name -> scalar map merged into the workflow's vars. Scalars are coerced to strings.",
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

export const ConfigSchema = Schema.Struct({
  vars: Schema.optional(Schema.Unknown.annotations({ jsonSchema: varsJsonSchema })),
  modes: Schema.optional(Schema.Unknown.annotations({ jsonSchema: modesJsonSchema })),
  ui: Schema.optional(UiSchema),
})

/** The decoded `ui:` shape — `gtd ui` and its CLI flags read `port`/`host`/`cert`/`key` off this. */
export type UiConfig = Schema.Schema.Type<typeof UiSchema>
