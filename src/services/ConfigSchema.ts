import { Schema } from "effect"

export const GtdConfigSchema = Schema.Struct({
  file: Schema.optional(Schema.String),
  modelPlan: Schema.optional(Schema.String),
  modelBuild: Schema.optional(Schema.String),
  modelLearn: Schema.optional(Schema.String),
  modelCommit: Schema.optional(Schema.String),
  testCmd: Schema.optional(Schema.String),
  testRetries: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))),
  commitPrompt: Schema.optional(Schema.String),
  agentInactivityTimeout: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(0))),
})

export type GtdPartialConfig = typeof GtdConfigSchema.Type
