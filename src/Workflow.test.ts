import { describe, expect, it } from "vitest"
import { defaultWorkflow, isDefinedActor, labelCounterStamps, zeroCounters } from "./Workflow.js"

/**
 * Definition-consistency checks (δ plan, phase D hardening): the interpreter
 * (`Machine.ts`) trusts the definition's internal references — actor names in
 * state/rule declarations, capture-rule stamps — so a typo'd or undeclared
 * actor must fail HERE, in a unit test over the definition data, not as a
 * silent never-matching rule at runtime.
 */

describe("defaultWorkflow — definition consistency", () => {
  it("declares at least one interactive and one autonomous actor", () => {
    expect(defaultWorkflow.actors.some((a) => a.kind === "interactive")).toBe(true)
    expect(defaultWorkflow.actors.some((a) => a.kind === "autonomous")).toBe(true)
  })

  it("actor names are unique and non-empty", () => {
    const names = defaultWorkflow.actors.map((a) => a.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name.length).toBeGreaterThan(0)
  })

  it("every state's awaited actor is declared (or the dynamic marker)", () => {
    for (const [state, def] of Object.entries(defaultWorkflow.states)) {
      expect(
        def.awaits === "dynamic" || isDefinedActor(def.awaits),
        `state "${state}" awaits undeclared actor "${def.awaits}"`,
      ).toBe(true)
    }
  })

  it("every state's prompt bindings are keyed by declared actors", () => {
    for (const [state, def] of Object.entries(defaultWorkflow.states)) {
      for (const actor of Object.keys(def.prompts ?? {})) {
        expect(
          isDefinedActor(actor),
          `state "${state}" binds a prompt for undeclared actor "${actor}"`,
        ).toBe(true)
      }
    }
  })

  it("every capture rule's actor restriction names a declared actor", () => {
    for (const [state, def] of Object.entries(defaultWorkflow.states)) {
      for (const rule of def.captureRules ?? []) {
        if (rule.actor !== undefined) {
          expect(
            isDefinedActor(rule.actor),
            `state "${state}" capture rule (label "${rule.label}") restricts to undeclared actor "${rule.actor}"`,
          ).toBe(true)
        }
      }
    }
  })

  it("every turn rule and rule-outcome actor is declared", () => {
    const checkOutcome = (outcome: { kind: string; actor?: string }, where: string): void => {
      if ((outcome.kind === "rest" || outcome.kind === "chain") && outcome.actor !== undefined) {
        expect(
          isDefinedActor(outcome.actor),
          `${where} resolves to undeclared actor "${outcome.actor}"`,
        ).toBe(true)
      }
    }
    for (const rule of defaultWorkflow.turnRules) {
      expect(
        isDefinedActor(rule.actor),
        `turn rule (${rule.actor}, ${rule.gate}) names an undeclared actor`,
      ).toBe(true)
      for (const branch of rule.branches) {
        checkOutcome(branch.to, `turn rule (${rule.actor}, ${rule.gate})`)
      }
    }
    for (const [phase, branches] of Object.entries(defaultWorkflow.routingRules)) {
      for (const branch of branches ?? []) checkOutcome(branch.to, `routing rule "${phase}"`)
    }
    for (const ladder of [defaultWorkflow.interrupts, defaultWorkflow.fallback]) {
      for (const rule of ladder) {
        for (const branch of rule.branches) checkOutcome(branch.to, "ladder rung")
      }
    }
  })

  it("capture-rule stamps and label stamps keep vectors non-negative from zero", () => {
    // A stamp that could go negative would corrupt every downstream trailer.
    for (const stamp of Object.values(labelCounterStamps)) {
      if (stamp === undefined) continue
      const next = stamp(zeroCounters)
      expect(next.testFixCount).toBeGreaterThanOrEqual(0)
      expect(next.reviewFixCount).toBeGreaterThanOrEqual(0)
      expect(next.healthFixCount).toBeGreaterThanOrEqual(0)
    }
  })
})
