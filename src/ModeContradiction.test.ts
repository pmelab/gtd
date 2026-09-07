import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildModeContradictionCheck,
  contradictionMessage,
  modeContradictionSkipNotice,
} from "./ModeContradiction.js"
import { shellQuote } from "./GitScript.js"
import { builtInModeNames, steeringFormatFor } from "./SteeringFormats.js"
import { parseFootnotes } from "./Footnotes.js"

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

/**
 * Formats `content` with the repo's real `oxfmt` binary, under the repo's own
 * `.oxfmtrc.json` — mirrors `src/SteeringFormats.test.ts`'s own helper of the
 * same name, kept local since this file has no other reason to depend on it.
 */
const formatWithOxfmt = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-mode-contradiction-oxfmt-"))
  try {
    writeFileSync(join(dir, ".oxfmtrc.json"), readFileSync(join(process.cwd(), ".oxfmtrc.json")))
    const file = join(dir, "sample.md")
    writeFileSync(file, content)
    execFileSync(join(process.cwd(), "node_modules", ".bin", "oxfmt"), ["--write", file], {
      cwd: dir,
    })
    return readFileSync(file, "utf8")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("each built-in format's canonical sample (T7: writing into a live worktree)", () => {
  it("contains a note attached the way the server attaches one — a distinct `na`-prefixed id, from `Footnotes.ts#footnoteAttachEdits`", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      const { definitions } = parseFootnotes(format.sample)
      expect(definitions.some((d) => /^na[0-9a-z]+$/.test(d.name))).toBe(true)
    }
  })

  it("still validates clean with zero findings", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      expect(format.validate(format.sample)).toEqual([])
    }
  })

  it("survives a round-trip through the formatter and still validates clean", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      const formatted = formatWithOxfmt(format.sample)
      expect(formatted).toBe(format.sample)
      expect(format.validate(formatted)).toEqual([])
    }
  })

  it("the server-written note is long enough to be reflowed at 80 columns, and still validates after reflow", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      const { definitions } = parseFootnotes(format.sample)
      const serverNote = definitions.find((d) => /^na[0-9a-z]+$/.test(d.name))!
      expect(serverNote.body.length).toBeGreaterThan(80)
      // Already reflowed (the sample is an oxfmt fixed point, asserted above)
      // — its body still spans more than one physical source line.
      expect(serverNote.endLine).toBeGreaterThan(serverNote.line)
    }
  })

  it("the server-written note contains a multi-word inline code span, and still validates after reflow", () => {
    for (const mode of builtInModeNames()) {
      const format = steeringFormatFor(mode)!
      const { definitions } = parseFootnotes(format.sample)
      const serverNote = definitions.find((d) => /^na[0-9a-z]+$/.test(d.name))!
      expect(serverNote.body).toMatch(/`[^`]*\s[^`]*`/)
      expect(format.validate(format.sample)).toEqual([])
    }
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
