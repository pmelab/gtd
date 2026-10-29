import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as published from "./index.js"
import * as internal from "./internal.js"

const DEPRECATED = [
  "installContext",
  "protocolMismatch",
  "FlowContext",
  "StepRequest",
  "configure",
  "isFactoryWorkflow",
  "Configured",
  "OptionIssue",
  "configProblems",
  "ConfigProblem",
]

describe("@pmelab/gtd/flows", () => {
  it("publishes exactly the authoring surface, its engine-only names still among it", () => {
    expect(Object.keys(published).sort()).toEqual(
      [
        "FLOWS_PROTOCOL",
        "FlowsProtocolError",
        "accessFor",
        "agent",
        "answered",
        "applyScript",
        "changes",
        "changesSince",
        "check",
        "checkScript",
        "codeChanges",
        "codeThreads",
        "configProblems",
        "configure",
        "defineConfig",
        "defineWorkflow",
        "displayPath",
        "env",
        "envSettings",
        "envSettingsOf",
        "glob",
        "hasThreadFor",
        "head",
        "human",
        "installContext",
        "isFactoryWorkflow",
        "judge",
        "judgeDiffShape",
        "kept",
        "mark",
        "matches",
        "moveScript",
        "numeric",
        "openQuestions",
        "protocolMismatch",
        "quote",
        "read",
        "refuse",
        "removeScript",
        "requireAnswers",
        "requireProgress",
        "requireReplies",
        "requireRevert",
        "requireThreadsClosed",
        "restart",
        "restoreScript",
        "revertScript",
        "run",
        "scope",
        "seamGate",
        "sectionBodies",
        "sections",
        "settings",
        "settingsOf",
        "showScript",
        "skillsFor",
        "start",
        "threads",
        "vars",
        "workflow",
        "writeScript",
        "wrote",
      ].sort(),
    )
  })

  it("marks every engine-only name deprecated", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")
    for (const name of DEPRECATED) {
      expect(source, name).toMatch(
        new RegExp(`/\\*\\* @deprecated [^\\n]*\\*/\\nexport (const|type) ${name} =`),
      )
    }
  })

  it("serves an engine-only name as the very value gtd's own code imports", () => {
    expect(published.installContext).toBe(internal.installContext)
    expect(published.configure).toBe(internal.configure)
    expect(published.isFactoryWorkflow).toBe(internal.isFactoryWorkflow)
    expect(published.configProblems).toBe(internal.configProblems)
    expect(published.protocolMismatch).toBe(internal.protocolMismatch)
  })
})
