import { Effect } from "effect"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import type { BoundaryLevel } from "./SandboxBoundaries.js"
import type { ConfigResult } from "./ConfigResolver.js"

export interface EscalationRule {
  readonly from: BoundaryLevel
  readonly to: BoundaryLevel
}

export type ApprovalDecision = "once" | "project" | "user" | "deny"

export type ApprovalResult = ApprovalDecision | "approved"

export interface EscalationPrompt {
  readonly prompt: (rule: EscalationRule) => Effect.Effect<ApprovalDecision>
}

export const hasApprovedEscalation = (
  rule: EscalationRule,
  configs: ReadonlyArray<ConfigResult>,
): boolean => {
  for (const config of configs) {
    const escalations = (config.config as Record<string, unknown>).approvedEscalations
    if (Array.isArray(escalations)) {
      for (const e of escalations) {
        if (e && typeof e === "object" && e.from === rule.from && e.to === rule.to) {
          return true
        }
      }
    }
  }
  return false
}

export const persistEscalationApproval = (
  rule: EscalationRule,
  filepath: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    let existing: Record<string, unknown> = {}
    const content = yield* Effect.tryPromise({
      try: () => readFile(filepath, "utf-8"),
      catch: () => null as never,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))

    if (content) {
      existing = JSON.parse(content)
    }

    const escalations: Array<{ from: string; to: string }> = Array.isArray(existing.approvedEscalations)
      ? [...existing.approvedEscalations]
      : []

    const alreadyExists = escalations.some((e) => e.from === rule.from && e.to === rule.to)
    if (!alreadyExists) {
      escalations.push({ from: rule.from, to: rule.to })
    }

    existing.approvedEscalations = escalations

    yield* Effect.tryPromise({
      try: () => mkdir(dirname(filepath), { recursive: true }),
      catch: (e) => new Error(`Failed to create directory: ${e}`),
    })

    yield* Effect.tryPromise({
      try: () => writeFile(filepath, JSON.stringify(existing, null, 2) + "\n", "utf-8"),
      catch: (e) => new Error(`Failed to write config: ${e}`),
    })
  })

export const requestEscalationApproval = (
  rule: EscalationRule,
  configs: ReadonlyArray<ConfigResult>,
  prompt: EscalationPrompt,
): Effect.Effect<ApprovalResult> => {
  if (hasApprovedEscalation(rule, configs)) {
    return Effect.succeed("approved" as const)
  }
  return prompt.prompt(rule)
}
