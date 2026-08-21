import { describe, expect, it } from "vitest"
import {
  buildModeContradictionCheck,
  contradictionMessage,
  modeContradictionSkipNotice,
} from "./ModeContradiction.js"
import { shellQuote } from "./GitScript.js"

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

  it("has no blank lines — the block must stay one Emit.ts block", () => {
    const block = buildModeContradictionCheck(inputs)
    expect(block.split("\n\n").length).toBe(1)
  })

  it("writes the sample with printf '%s', never a heredoc", () => {
    const block = buildModeContradictionCheck(inputs)
    expect(block.startsWith(`printf '%s' ${shellQuote(inputs.sample)} > `)).toBe(true)
    expect(block).not.toContain("<<")
  })

  it("runs the rendered format: command verbatim, right after the printf line", () => {
    const block = buildModeContradictionCheck(inputs)
    const afterPrintf = block.slice(
      `printf '%s' ${shellQuote(inputs.sample)} > ${shellQuote(inputs.samplePath)}\n`.length,
    )
    expect(afterPrintf.startsWith(inputs.formatCommand)).toBe(true)
  })

  it("re-validates via gtd check <mode> <samplePath> with output discarded", () => {
    const block = buildModeContradictionCheck(inputs)
    expect(block).toContain(`gtd check qa '${inputs.samplePath}' >/dev/null 2>&1 || {`)
  })

  it("on failure prints the message, cats the sample, removes it, and exits non-zero", () => {
    const block = buildModeContradictionCheck(inputs)
    const failureBranch = block.slice(block.indexOf("|| {"))
    expect(failureBranch).toContain(`cat '${inputs.samplePath}' >&2`)
    expect(failureBranch).toContain(`rm -f '${inputs.samplePath}'`)
    expect(failureBranch).toContain(`exit 1`)
  })

  it("on success removes the sample and continues (no trailing exit)", () => {
    const block = buildModeContradictionCheck(inputs)
    expect(block.endsWith(`rm -f '${inputs.samplePath}'`)).toBe(true)
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
