import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  AGENTS,
  buildClaudeArgv,
  buildPiArgv,
  CLAUDE_TOOLS,
  parseArgs,
  PI_TOOLS,
  readFeedback,
} from "../../evals/run-turn.mjs"

describe("buildPiArgv", () => {
  it("pins pi's tool surface to the four docs/development.md promises", () => {
    const argv = buildPiArgv("some-model", "system prompt", "key")
    const toolsIdx = argv.indexOf("--tools")
    expect(toolsIdx).toBeGreaterThanOrEqual(0)
    expect(argv[toolsIdx + 1]).toBe(PI_TOOLS)
    expect(PI_TOOLS).toBe("read,write,edit,bash")
  })
})

describe("buildClaudeArgv", () => {
  it("pins Claude Code's tool surface to the same four promises, in its own spelling", () => {
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
  it("defaults to the claude agent when no --agent flag is passed", () => {
    expect(parseArgs(["--planner", "opus", "--coder", "sonnet", "spec-review:clean"])).toEqual({
      agent: "claude",
      models: { planner: "opus", coder: "sonnet" },
      caseName: "spec-review",
      variant: "clean",
    })
  })

  it("takes --agent, and still finds the positional after it", () => {
    expect(
      parseArgs(["--agent", "pi", "--planner", "a", "--coder", "b", "build-fix:violation"]),
    ).toEqual({
      agent: "pi",
      models: { planner: "a", coder: "b" },
      caseName: "build-fix",
      variant: "violation",
    })
  })
})

describe("AGENTS", () => {
  // Only the gateway-backed agent may demand GTD_EVALS_URL/KEY — a claude
  // run that blocked on them would be unrunnable on a machine with no
  // gateway at all, which is the whole point of it being the default.
  it("marks pi as gateway-backed and claude as not", () => {
    expect(AGENTS.pi.needsGateway).toBe(true)
    expect(AGENTS.claude.needsGateway).toBe(false)
  })
})

// No bundled case currently declares no `artifact` (every one of the nine
// needs some content read back), so this branch has no live case exercising
// it end to end — this is that coverage instead.
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
