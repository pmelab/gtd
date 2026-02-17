import { Schema } from "effect"

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
})

export type GtdPartialConfig = typeof GtdConfigSchema.Type
