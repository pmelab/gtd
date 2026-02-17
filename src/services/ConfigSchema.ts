import { Schema } from "effect"

const BoundaryLevelSchema = Schema.Literal("restricted", "standard", "elevated")

const EscalationRuleSchema = Schema.Struct({
  from: BoundaryLevelSchema,
  to: BoundaryLevelSchema,
})

const SandboxBoundariesSchema = Schema.Struct({
  plan: Schema.optional(BoundaryLevelSchema),
  build: Schema.optional(BoundaryLevelSchema),
  learn: Schema.optional(BoundaryLevelSchema),
})

const EscalationPolicySchema = Schema.Literal("auto", "prompt")

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
  sandboxEscalationPolicy: Schema.optional(EscalationPolicySchema),
  sandboxApprovedEscalations: Schema.optional(Schema.Array(EscalationRuleSchema)),
  approvedEscalations: Schema.optional(Schema.Array(EscalationRuleSchema)),
})

export type GtdPartialConfig = typeof GtdConfigSchema.Type
