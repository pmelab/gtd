import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildModeContradictionCheck,
  contradictionMessage,
  modeContradictionSkipNotice,
} from "./ModeContradiction.js"
import { shellQuote } from "./index.js"

describe("buildModeContradictionCheck", () => {
  const inputs = {
    mode: "qa",
    samplePath: "/fixture-scratch/gtd-mode-sample-qa-12345.md",
    sample: "Sample plan.\n",
    formatCommand: "npx oxfmt --write '/fixture-scratch/gtd-mode-sample-qa-12345.md'",
  }

  it("pins the block's exact bytes against a path the test supplies", () => {
    const block = buildModeContradictionCheck(inputs)
    const pathQ = shellQuote(inputs.samplePath)
    const messageQ = shellQuote(contradictionMessage(inputs.mode, inputs.formatCommand))
    expect(block).toBe(
      [
        `printf '%s' ${shellQuote(inputs.sample)} > ${pathQ}`,
        inputs.formatCommand,
        `gtd check qa ${pathQ} >/dev/null 2>&1 || {`,
        `  printf '%s\\n' ${messageQ} >&2`,
        `  cat ${pathQ} >&2`,
        `  rm -f ${pathQ}`,
        `  exit 1`,
        `}`,
        `rm -f ${pathQ}`,
      ].join("\n"),
    )
  })

  it("shell-quotes a sample containing single quotes and newlines safely", () => {
    const sample = "a 'quoted' sample\nwith two lines\n"
    const block = buildModeContradictionCheck({ ...inputs, sample })
    expect(
      block.startsWith(`printf '%s' ${shellQuote(sample)} > ${shellQuote(inputs.samplePath)}`),
    ).toBe(true)
  })
})

describe("contradictionMessage", () => {
  const message = contradictionMessage("review", "npx oxfmt --write '<file>'")

  it("names the mode", () => {
    expect(message).toContain('"review"')
  })

  it("tells the agent this is a configuration bug and not the steering file", () => {
    expect(message.toLowerCase()).toContain("configuration bug")
    expect(message).toContain("Do NOT edit the steering file")
  })

  it("tells the agent to stop and end its turn", () => {
    expect(message.toLowerCase()).toContain("stop and end your turn")
  })

  it("names the exact rendered format: command", () => {
    expect(message).toContain("npx oxfmt --write '<file>'")
  })

  it("is not fixPromptInstruction's text and shares no wording that blames the turn", () => {
    expect(message).not.toContain("Your last turn")
    expect(message).not.toContain("Fix these format violations")
  })
})

describe("modeContradictionSkipNotice", () => {
  it("is a single printf-to-stderr line naming the mode", () => {
    const line = modeContradictionSkipNotice("adr")
    expect(line.split("\n").length).toBe(1)
    expect(line).toContain(">&2")
    expect(line).toContain("adr")
    expect(line.toLowerCase()).toContain("skip")
  })
})

describe("buildModeContradictionCheck, run for real (a stub `gtd check` standing in for a reflow-broken validator)", () => {
  it("fails loudly, naming the mode and printing the rendered format: command, when the mode's validator rejects the (simulated) reflowed sample", () => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-mode-contradiction-run-"))
    try {
      // A stub `gtd` on PATH ahead of the real one: `check` always fails,
      // standing in for a `format:` command whose reflow broke the sample.
      writeFileSync(join(dir, "gtd"), '#!/bin/sh\nif [ "$1" = check ]; then exit 1; fi\nexit 0\n', {
        mode: 0o755,
      })
      const samplePath = join(dir, "sample.md")
      const script = buildModeContradictionCheck({
        mode: "review",
        samplePath,
        sample: "irrelevant, only shape matters here",
        formatCommand: "true", // the "format:" command itself is a no-op; the stub `gtd check` simulates the break it would cause
      })
      let result: { readonly status: number | null; readonly stderr: string }
      try {
        execFileSync("bash", ["-c", script], {
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
          stdio: ["ignore", "pipe", "pipe"],
        })
        result = { status: 0, stderr: "" }
      } catch (error) {
        const err = error as { status: number | null; stderr: Buffer }
        result = { status: err.status, stderr: err.stderr.toString() }
      }
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('"review"')
      expect(result.stderr).toContain("CONFIGURATION BUG")
      expect(result.stderr).toContain("true") // the rendered format: command
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
