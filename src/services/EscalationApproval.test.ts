import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BoundaryLevel } from "./SandboxBoundaries.js"
import {
  type EscalationRule,
  type ApprovalDecision,
  hasApprovedEscalation,
  persistEscalationApproval,
  requestEscalationApproval,
  type EscalationPrompt,
} from "./EscalationApproval.js"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gtd-escalation-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const makeRule = (from: BoundaryLevel, to: BoundaryLevel): EscalationRule => ({ from, to })

describe("hasApprovedEscalation", () => {
  it("returns false when no approvedEscalations exist in config", () => {
    const result = hasApprovedEscalation(makeRule("restricted", "standard"), [
      { config: { file: "TODO.md" }, filepath: "/a" },
    ])
    expect(result).toBe(false)
  })

  it("returns true when matching escalation exists in project config", () => {
    const result = hasApprovedEscalation(makeRule("restricted", "standard"), [
      {
        config: {
          approvedEscalations: [{ from: "restricted", to: "standard" }],
        },
        filepath: "/project/.gtdrc.json",
      },
    ])
    expect(result).toBe(true)
  })

  it("returns true when matching escalation exists in user config", () => {
    const result = hasApprovedEscalation(makeRule("standard", "elevated"), [
      { config: { file: "TODO.md" }, filepath: "/project/.gtdrc.json" },
      {
        config: {
          approvedEscalations: [{ from: "standard", to: "elevated" }],
        },
        filepath: "/home/.gtdrc.json",
      },
    ])
    expect(result).toBe(true)
  })

  it("returns false when escalation rule does not match", () => {
    const result = hasApprovedEscalation(makeRule("restricted", "elevated"), [
      {
        config: {
          approvedEscalations: [{ from: "restricted", to: "standard" }],
        },
        filepath: "/project/.gtdrc.json",
      },
    ])
    expect(result).toBe(false)
  })

  it("returns true when matching rule exists in any config level", () => {
    const result = hasApprovedEscalation(makeRule("restricted", "standard"), [
      { config: {}, filepath: "/project/.gtdrc.json" },
      {
        config: {
          approvedEscalations: [{ from: "restricted", to: "standard" }],
        },
        filepath: "/home/.gtdrc.json",
      },
    ])
    expect(result).toBe(true)
  })
})

describe("persistEscalationApproval", () => {
  it("creates config file with escalation rule when file does not exist", async () => {
    const filepath = join(tempDir, ".gtdrc.json")
    await Effect.runPromise(persistEscalationApproval(makeRule("restricted", "standard"), filepath))

    const content = JSON.parse(await readFile(filepath, "utf-8"))
    expect(content.approvedEscalations).toEqual([{ from: "restricted", to: "standard" }])
  })

  it("appends escalation rule to existing config", async () => {
    const filepath = join(tempDir, ".gtdrc.json")
    await writeFile(filepath, JSON.stringify({ file: "PLAN.md" }, null, 2))

    await Effect.runPromise(persistEscalationApproval(makeRule("restricted", "standard"), filepath))

    const content = JSON.parse(await readFile(filepath, "utf-8"))
    expect(content.file).toBe("PLAN.md")
    expect(content.approvedEscalations).toEqual([{ from: "restricted", to: "standard" }])
  })

  it("appends to existing approvedEscalations array", async () => {
    const filepath = join(tempDir, ".gtdrc.json")
    await writeFile(
      filepath,
      JSON.stringify({
        approvedEscalations: [{ from: "restricted", to: "standard" }],
      }, null, 2),
    )

    await Effect.runPromise(persistEscalationApproval(makeRule("standard", "elevated"), filepath))

    const content = JSON.parse(await readFile(filepath, "utf-8"))
    expect(content.approvedEscalations).toEqual([
      { from: "restricted", to: "standard" },
      { from: "standard", to: "elevated" },
    ])
  })

  it("does not duplicate existing escalation rule", async () => {
    const filepath = join(tempDir, ".gtdrc.json")
    await writeFile(
      filepath,
      JSON.stringify({
        approvedEscalations: [{ from: "restricted", to: "standard" }],
      }, null, 2),
    )

    await Effect.runPromise(persistEscalationApproval(makeRule("restricted", "standard"), filepath))

    const content = JSON.parse(await readFile(filepath, "utf-8"))
    expect(content.approvedEscalations).toEqual([{ from: "restricted", to: "standard" }])
  })

  it("creates parent directories if needed", async () => {
    const filepath = join(tempDir, "nested", "dir", ".gtdrc.json")
    await Effect.runPromise(persistEscalationApproval(makeRule("restricted", "standard"), filepath))

    const content = JSON.parse(await readFile(filepath, "utf-8"))
    expect(content.approvedEscalations).toEqual([{ from: "restricted", to: "standard" }])
  })
})

describe("requestEscalationApproval", () => {
  const makePrompt = (decision: ApprovalDecision): EscalationPrompt => ({
    prompt: () => Effect.succeed(decision),
  })

  it("returns 'once' when user approves once", async () => {
    const result = await Effect.runPromise(
      requestEscalationApproval(
        makeRule("restricted", "standard"),
        [],
        makePrompt("once"),
      ),
    )
    expect(result).toBe("once")
  })

  it("returns 'project' when user saves to project config", async () => {
    const result = await Effect.runPromise(
      requestEscalationApproval(
        makeRule("restricted", "standard"),
        [],
        makePrompt("project"),
      ),
    )
    expect(result).toBe("project")
  })

  it("returns 'user' when user saves to user config", async () => {
    const result = await Effect.runPromise(
      requestEscalationApproval(
        makeRule("restricted", "standard"),
        [],
        makePrompt("user"),
      ),
    )
    expect(result).toBe("user")
  })

  it("returns 'deny' when user denies", async () => {
    const result = await Effect.runPromise(
      requestEscalationApproval(
        makeRule("restricted", "standard"),
        [],
        makePrompt("deny"),
      ),
    )
    expect(result).toBe("deny")
  })

  it("skips prompt and returns 'approved' when saved approval exists", async () => {
    let promptCalled = false
    const prompt: EscalationPrompt = {
      prompt: () => {
        promptCalled = true
        return Effect.succeed("deny" as const)
      },
    }

    const configs = [
      {
        config: {
          approvedEscalations: [{ from: "restricted", to: "standard" }],
        } as Record<string, unknown>,
        filepath: "/project/.gtdrc.json",
      },
    ]

    const result = await Effect.runPromise(
      requestEscalationApproval(makeRule("restricted", "standard"), configs, prompt),
    )
    expect(result).toBe("approved")
    expect(promptCalled).toBe(false)
  })

  it("prompts when no saved approval exists", async () => {
    let promptCalled = false
    const prompt: EscalationPrompt = {
      prompt: () => {
        promptCalled = true
        return Effect.succeed("once" as const)
      },
    }

    const result = await Effect.runPromise(
      requestEscalationApproval(makeRule("restricted", "standard"), [], prompt),
    )
    expect(result).toBe("once")
    expect(promptCalled).toBe(true)
  })
})
