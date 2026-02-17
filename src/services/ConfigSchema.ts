import { Schema } from "effect"

const FilesystemOverridesSchema = Schema.Struct({
  allowRead: Schema.optional(Schema.Array(Schema.String)),
  allowWrite: Schema.optional(Schema.Array(Schema.String)),
})

const NetworkOverridesSchema = Schema.Struct({
  allowedDomains: Schema.optional(Schema.Array(Schema.String)),
})

const SandboxBoundariesSchema = Schema.Struct({
  filesystem: Schema.optional(FilesystemOverridesSchema),
  network: Schema.optional(NetworkOverridesSchema),
})

export const GtdConfigSchema = Schema.Struct({
  file: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  agentPlan: Schema.optional(Schema.String),
  agentBuild: Schema.optional(Schema.String),
  agentLearn: Schema.optional(Schema.String),
  testCmd: Schema.optional(Schema.String),
  testRetries: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))),
  commitPrompt: Schema.optional(Schema.String),
  agentInactivityTimeout: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))),
  sandboxEnabled: Schema.optional(Schema.Boolean),
  sandboxBoundaries: Schema.optional(SandboxBoundariesSchema),
})

export type GtdPartialConfig = typeof GtdConfigSchema.Type
