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
    "Steering-file modes a workflow step's mode: may name. Each entry declares at least one of format/validate: shell commands (Eta templates seeing it.file = the rendered steering-file path) gtd runs via bash. format rewrites the file in place; validate exits 0 when valid, non-zero with findings on stdout/stderr otherwise. The halves layer independently, so naming a built-in mode (qa/review) and declaring only format: adds formatting while keeping gtd's own validation. gtd ships no formatter — bring your own (prettier, dprint, a script).",
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

/** The top-level `ui:` shape: `gtd ui`'s own settings (listen address/TLS) for the one worktree it serves. */
const uiJsonSchema = {
  type: "object",
  description: "Settings for `gtd ui`: where it listens, and optional TLS.",
  additionalProperties: false,
  properties: {
    port: {
      type: "integer",
      description:
        "For ui, the tailscale serve port (default: the first free of 8443, 10000, 443), or the bind port when --host opts out of serve (default: a free port).",
    },
    host: {
      type: "string",
      description: "Host/interface `gtd ui` binds to.",
    },
    cert: {
      type: "string",
      description: "Path to a TLS certificate file, enabling HTTPS. Requires `key` too.",
    },
    key: {
      type: "string",
      description: "Path to a TLS private key file, enabling HTTPS. Requires `cert` too.",
    },
    format: {
      type: "string",
      description:
        "Shell command run after every UI write, before it resolves (Eta template; it.file is the written file's absolute path). A non-zero exit or missing binary never reverts the write or refuses it — it's reported to the client as a notice naming the command and its exit code. Absent means no command runs at all.",
    },
  },
} as const

/**
 * `ui:`'s own shape is a plain, flat settings struct — unlike `vars`/`modes`
 * it needs no MULTI-TEMPLATE compile step (no per-mode map to walk), so it is
 * a real (not `Unknown`) schema: excess sub-keys under `ui:` are rejected the
 * same way as any other excess key, by the `onExcessProperty: "error"` decode
 * option `Config.ts` already passes for the whole config (it applies
 * recursively). `format` IS an Eta template (`it.file` bound to the written
 * file's absolute path, rendered the same way a mode's own `format:` is) —
 * it's just a single string field, not a nested map, so it needs no compiler
 * of its own the way `modes:` does. `uiJsonSchema` above still overrides the
 * derived JSON Schema so the published shape stays a hand-annotated literal
 * like its siblings.
 *
 * Deliberate deviation from this package's own T1 prose, which asked for an
 * unknown `ui:` sub-key to be "a decode failure at exit 2": every OTHER
 * config decode failure in this codebase (an unknown top-level key included —
 * see `Config.ts`'s `formatSchemaError`) exits 1, `EXIT_RUNTIME_ERROR` — a
 * `ui:`-only exception would be the one config error in the whole CLI that
 * exits 2, `EXIT_USAGE_ERROR`, for no reason a user could infer. Consistency
 * with the rest of `.gtdrc` decoding wins; this exits 1 like every sibling.
 */
const UiSchema = Schema.Struct({
  port: Schema.optional(Schema.Int),
  host: Schema.optional(Schema.String),
  cert: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  format: Schema.optional(Schema.String),
}).annotations({ jsonSchema: uiJsonSchema })

export const ConfigSchema = Schema.Struct({
  // Decoded only so its compile step can name gtd.config.ts; the published
  // schema rejects it.
  workflow: Schema.optional(Schema.Unknown.annotations({ jsonSchema: { not: {} } })),
  vars: Schema.optional(Schema.Unknown.annotations({ jsonSchema: varsJsonSchema })),
  modes: Schema.optional(Schema.Unknown.annotations({ jsonSchema: modesJsonSchema })),
  ui: Schema.optional(UiSchema),
})

/** The decoded `ui:` shape — `gtd ui` and its CLI flags read `port`/`host`/`cert`/`key` off this. */
export type UiConfig = Schema.Schema.Type<typeof UiSchema>
