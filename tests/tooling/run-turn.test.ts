import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildClaudeArgv, CLAUDE_TOOLS, parseArgs, readFeedback } from "../../evals/run-turn.mjs"
import { matchGtdFiles } from "../../evals/expect.mjs"
import { checkLandError, SHARED_CHECKS, safeGrade } from "../../evals/asserts/shared.mjs"

describe("buildClaudeArgv", () => {
  it("pins Claude Code's tool surface to the four docs/development.md promises", () => {
    const argv = buildClaudeArgv("sonnet", "system prompt")
    const toolsIdx = argv.indexOf("--tools")
    expect(toolsIdx).toBeGreaterThanOrEqual(0)
    expect(argv[toolsIdx + 1]).toBe(CLAUDE_TOOLS)
    expect(CLAUDE_TOOLS).toBe("Read,Write,Edit,Bash")
  })

  // `--append-system-prompt` would grade gtd's prompt stacked on top of
  // Claude Code's own — the state's prompt has to BE the system prompt, or
  // the cell measures the sum of two prompts.
  it("replaces the system prompt rather than appending to it", () => {
    const argv = buildClaudeArgv("sonnet", "system prompt")
    expect(argv).toContain("--system-prompt")
    expect(argv).not.toContain("--append-system-prompt")
    expect(argv[argv.indexOf("--system-prompt") + 1]).toBe("system prompt")
  })

  // A machine's own settings, hooks and output style must never reach a
  // graded turn, or a baseline cell measures the machine as much as the
  // prompt. Auth is unaffected by this flag, so the local login still works.
  it("loads no user, project or local settings", () => {
    const argv = buildClaudeArgv("sonnet", "system prompt")
    expect(argv[argv.indexOf("--setting-sources") + 1]).toBe("")
  })

  it("passes the turn's model straight through, with no provider prefix", () => {
    expect(buildClaudeArgv("opus", "s")[buildClaudeArgv("opus", "s").indexOf("--model") + 1]).toBe(
      "opus",
    )
  })
})

describe("parseArgs", () => {
  it("reads both model classes and the trailing case:variant positional", () => {
    expect(parseArgs(["--planner", "opus", "--coder", "sonnet", "spec-review:clean"])).toEqual({
      models: { planner: "opus", coder: "sonnet" },
      caseName: "spec-review",
      variant: "clean",
    })
  })

  // With no flags at all nothing is consumed, so the positional must still be
  // found at index 0 rather than skipped as a flag value.
  it("finds the positional when no flags precede it", () => {
    expect(parseArgs(["build-fix:violation"])).toEqual({
      models: { planner: undefined, coder: undefined },
      caseName: "build-fix",
      variant: "violation",
    })
  })
})

describe("readFeedback", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it("skips cleanly, reading nothing, when the case declares no artifact", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-run-turn-test-"))
    expect(readFeedback(dir, {})).toEqual({ feedbackExists: false, feedback: "" })
  })

  it("reports feedbackExists: false when the declared artifact isn't on disk", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-run-turn-test-"))
    expect(readFeedback(dir, { artifact: "src/missing.ts" })).toEqual({
      feedbackExists: false,
      feedback: "",
    })
  })

  it("reads the declared artifact's content back as feedback when present", () => {
    dir = mkdtempSync(join(tmpdir(), "gtd-eval-run-turn-test-"))
    writeFileSync(join(dir, "src.ts"), "export const x = 1\n")
    expect(readFeedback(dir, { artifact: "src.ts" })).toEqual({
      feedbackExists: true,
      feedback: "export const x = 1\n",
    })
  })
})

describe("matchGtdFiles", () => {
  it("behaves byte-identically to a JSON.stringify equality", () => {
    expect(matchGtdFiles([".gtd/REQUIREMENTS.md"], [".gtd/REQUIREMENTS.md"])).toBeUndefined()
    expect(matchGtdFiles([], [".gtd/REQUIREMENTS.md"])).toBe(
      'gtdFilesChanged was [], expected [".gtd/REQUIREMENTS.md"]',
    )
  })
})

describe("checkLandError", () => {
  it("fails whenever result.landError is present, independent of any other field", () => {
    expect(
      checkLandError({ landError: "gtd: refusing, no pending change matches an edge" }),
    ).toEqual({
      pass: false,
      score: 0,
      reason: expect.stringContaining("refusing, no pending change"),
    })
  })

  it("passes through when landError is absent", () => {
    expect(checkLandError({})).toBeUndefined()
  })

  // The bug this regression test pins: a refused land leaves every file-list
  // field empty, which used to read as a clean pass for a variant whose OWN
  // expectation is "changed nothing".
  it("makes safeGrade fail a land refusal even when the case expects no changes", () => {
    const caseDef = { expect: { clean: { gtdFiles: [], otherFiles: "none" } } }
    const result = {
      feedbackExists: false,
      feedback: "",
      gtdFilesChanged: [],
      otherFilesChanged: [],
      unformatted: [],
      landedSubject: "",
      structurallyOk: false,
      landError: "refusing",
    }
    const verdict = safeGrade(
      JSON.stringify(result),
      { vars: { variant: "clean" } },
      caseDef,
      SHARED_CHECKS,
    )
    expect(verdict).toEqual({ pass: false, score: 0, reason: "gtd land refused: refusing" })
  })
})
