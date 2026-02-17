import { Schema } from "effect"

const EscalationRuleSchema = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
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
  approvedEscalations: Schema.optional(Schema.Array(EscalationRuleSchema)),
})

export type GtdPartialConfig = typeof GtdConfigSchema.Type
