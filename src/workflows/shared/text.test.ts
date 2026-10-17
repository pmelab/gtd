import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildReviewTriageMessage,
  deferNotesScript,
  buildReviewReviewingPrompt,
  agentWithSkills,
  architectureAuthorPrompt,
  architectureGateAnswerMessage,
  buildFixPrompt,
  buildFixQualityPrompt,
  buildQualityReviewingPrompt,
  buildReviewAwaitReviewMessage,
  buildReviewCollectingPrompt,
  designGateAnswerMessage,
  designTriagePrompt,
  implementBuildingPrompt,
  implementFixPrompt,
  naivePassPrompt,
  seamByHandMessage,
  seamSteerMessage,
  summaryPrompt,
  withSkills,
} from "./text.js"
import { applyEmittedScript, InMemRepo } from "../../testkit/index.js"
import { captureStep, renderText } from "./text.fixture.js"

describe("withSkills", () => {
  const prompted = (skills: string | undefined) =>
    renderText(() => withSkills(skills, "do-the-work"))

  it("puts the preamble, naming the skills, ahead of the prompt", () => {
    const prompt = prompted("code-review, testing")
    expect(prompt).toContain("missing one: code-review, testing")
    expect(prompt.endsWith("\n\ndo-the-work")).toBe(true)
  })

  it("leaves the prompt bare when there are no skills", () => {
    expect(prompted(undefined)).toBe("do-the-work")
    expect(prompted("  ")).toBe("do-the-work")
  })
})

describe("agentWithSkills", () => {
  const capture = (fn: () => Promise<void>, skills?: Readonly<Record<string, readonly string[]>>) =>
    captureStep(fn, { scope: "a", ...(skills !== undefined ? { skills } : {}) })

  it("puts the scope's list, joined, in the preamble", async () => {
    const request = await capture(() => agentWithSkills("name", "do-the-work"), {
      a: ["code-review", "testing"],
    })
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).toBe(withSkills("code-review, testing", "do-the-work"))
  })

  it("passes no skills option itself — the replay resolver fills the wire field", async () => {
    const request = await capture(() => agentWithSkills("name", "do-the-work"))
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.options).not.toHaveProperty("skills")
  })

  it("leaves the prompt bare when the scope resolves to an empty list", async () => {
    const request = await capture(() => agentWithSkills("name", "do-the-work"), { a: [] })
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).toBe("do-the-work")
  })
})

describe("agentWithSkills access preamble", () => {
  const capture = (
    context: Parameters<typeof captureStep>[1],
    options: Parameters<typeof agentWithSkills>[2] = {},
  ) => captureStep(() => agentWithSkills("name", "do-the-work", options), context)

  it("names each restricted side, after the skills preamble and before the prompt", async () => {
    const request = await capture({
      scope: "a",
      skills: { a: ["testing"] },
      access: { a: { read: ["docs/**"], write: ["out/**"] } },
    })
    if (request.kind !== "agent") throw new Error("unreachable")
    const prompt = request.prompt
    expect(prompt).toContain("- This turn may read only: docs/**")
    expect(prompt).toContain(
      "- This turn may write only: out/** — anything else is refused when the turn lands",
    )
    expect(prompt.indexOf("missing one: testing")).toBeLessThan(
      prompt.indexOf("This turn may read only"),
    )
    expect(prompt.endsWith("\n\ndo-the-work")).toBe(true)
  })

  it("folds the steering file into the named globs", async () => {
    const request = await capture(
      { scope: "a", access: { a: { write: [] } } },
      { file: ".gtd/NOTES.md" },
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).toContain("may write only: .gtd/NOTES.md —")
    expect(request.prompt).not.toContain("may read only")
  })

  it("leaves the prompt byte-identical when both sides are unrestricted", async () => {
    const request = await capture({ scope: "a", skills: { a: [] }, access: { a: {} } })
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).toBe("do-the-work")
  })
})

describe("the risk tier prompt and gate line", () => {
  const triage = (riskTier: boolean) => renderText(() => designTriagePrompt("base", riskTier))
  const gate = (riskTier: boolean) => renderText(() => designGateAnswerMessage(riskTier))

  it("asks for the tier and the signals, before the answered questions, unsure meaning high", () => {
    const prompt = triage(true)
    expect(prompt).toContain("`## Risk Tier`")
    expect(prompt).toContain("`## Production Signals`")
    expect(prompt).toContain("BEFORE `## Answered Questions`")
    expect(prompt).toContain("unsure means `high`")
    expect(prompt).toContain("Whichever lap this is")
  })

  it("only appends the tier section when on", () => {
    expect(triage(false)).not.toContain("Risk Tier")
    expect(triage(true).startsWith(triage(false))).toBe(true)
  })

  it("says how to override the tier at the gate when on", () => {
    expect(gate(true)).toContain("edit the first word under `## Risk Tier`")
    expect(gate(true)).toContain("approve the next lap with no further change")
    expect(gate(true)).toContain("means `high`")
    expect(gate(false)).not.toContain("Risk Tier")
    expect(gate(true).startsWith(gate(false))).toBe(true)
  })
})

describe("the shared open-question instruction", () => {
  it("leaves the option count to the agent, floored at two real options", () => {
    const prompt = renderText(() => designTriagePrompt("base"))
    expect(prompt).toContain("count of concrete options is your call")
    expect(prompt).toContain("at least two real options plus the")
    expect(prompt).not.toContain("plus a checkbox list: two")
  })

  it("requires a body between the heading and the option list", () => {
    const prompt = renderText(() => designTriagePrompt("base"))
    expect(prompt).toContain("followed by one or two lines of body naming the fork")
    expect(prompt).toContain("what actually differs, THEN the option list")
  })

  it("requires per-option impacts, free-form with no fixed count", () => {
    const prompt = renderText(() => designTriagePrompt("base"))
    expect(prompt).toContain("its own impacts nested under it")
    expect(prompt).toContain("one to four bullets, free-form")
    expect(prompt).toContain("labels, no fixed bullet count")
  })

  it("is the identical block, full text, in both the design gate and the architecture gate", () => {
    // Anchored at questionBar's own first and last lines (not a bullet
    // partway in) so the whole ~3.4k-char block is compared — a divergence
    // anywhere inside, including its opening bullets, fails this test the
    // moment either gate's copy drifts from the shared source.
    const start = "The goal is shared understanding, not a quota or an empty section"
    const end = "Never tick a box yourself — the human ticks exactly one per question"
    const sharedBlock = (prompt: string): string =>
      prompt.slice(prompt.indexOf(start), prompt.indexOf(end) + end.length)

    const designBlock = sharedBlock(renderText(() => designTriagePrompt("base")))
    const architectureBlock = sharedBlock(renderText(() => architectureAuthorPrompt()))

    expect(designBlock.length).toBeGreaterThan(3000)
    expect(designBlock).toBe(architectureBlock)
  })
})

describe("answered-entry footnote exception", () => {
  const exception = "carrying a human footnote on its"
  it("is in the design return lap and loop-back, keeping the deleted-question rule", () => {
    const prompt = renderText(() => designTriagePrompt("base"))
    expect(prompt).toContain("Never re-raise a deleted question")
    expect(prompt).toContain(`entry stays settled, except one ${exception}`)
    expect(prompt).toContain(`stays settled, except\n  one ${exception}`)
    expect(prompt).not.toContain("never re-open a settled")
    expect(prompt).not.toContain("never re-open one")
  })

  it("is in the architecture return lap and keeps the first-lap settled line", () => {
    const prompt = renderText(() => architectureAuthorPrompt())
    expect(prompt).toContain(`entry stays settled, except one ${exception}`)
    expect(prompt).not.toContain("never re-open a settled")
    expect(prompt).toMatch(/treat every decision[\s\S]*as settled — never re-open it/)
  })
})

describe("architectureAuthorPrompt", () => {
  it("qualifies the PERMISSIVE default with a settled-requirements exception", () => {
    const prompt = renderText(() => architectureAuthorPrompt())
    expect(prompt).toContain("is an open question, not a")
  })
  it("names the four content sections in order and the entry forms", () => {
    const prompt = renderText(() => architectureAuthorPrompt())
    const at = ["## Interfaces", "## Call Stacks", "## E2E Scenarios", "## Unit Tests"].map((h) =>
      prompt.indexOf(h),
    )
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(prompt).toContain("- unit: <path>")
    expect(prompt).toContain("- e2e: <path>")
    expect(prompt).toContain("- chore: <path>")
    expect(prompt).toContain("No e2e change.")
  })
})

describe("buildFixPrompt", () => {
  it("starts each bullet on its own line", () => {
    const prompt = renderText(() => buildFixPrompt())
    expect(prompt).toMatch(/\n- Leave everything uncommitted — do not commit\n$/)
    expect(prompt).toContain("writes its own\n- Leave")
  })
})

describe("buildFixQualityPrompt", () => {
  it("states the missing-test-signal-beats-line-count tiebreak", () => {
    const prompt = renderText(() => buildFixQualityPrompt())
    expect(prompt).toContain("missing test signal beats line count")
    expect(prompt).toContain("a test is never deleted to satisfy a simplification finding")
  })
})

describe("buildFixQualityPrompt scope", () => {
  it("fixes every finding, blocking or not", () => {
    const prompt = renderText(() => buildFixQualityPrompt())
    expect(prompt).toContain("fix every finding in every chunk, blocking or not")
    expect(prompt).not.toContain("found something blocking")
  })
})

describe("buildQualityReviewingPrompt", () => {
  const prompt = renderText(() => buildQualityReviewingPrompt("x"))
  it("traces, reads touched paths on a large change, and judges tests by reasoning", () => {
    expect(prompt).toContain("Trace, do not skim")
    expect(prompt).toContain("order of external calls against")
    expect(prompt).toContain("read the touched code")
    expect(prompt).toContain("would fail with the guarded")
    expect(prompt).toContain("never by running a")
    expect(prompt).toContain("pins a bug is a finding")
  })
  it("writes every finding and approves only when nothing was found", () => {
    expect(prompt).toContain("APPEND every finding you have, blocking or not")
    expect(prompt).toContain("only when this lens found nothing at all")
    expect(prompt).not.toContain("Write nothing when nothing is blocking")
  })
  it("adds a brief block only when given one", () => {
    expect(prompt).not.toContain("This lens's brief")
    expect(renderText(() => buildQualityReviewingPrompt("x", "BRIEF-TEXT"))).toContain(
      "This lens's brief:\nBRIEF-TEXT",
    )
  })
})

// These cases run real git and sh on purpose: they prove the command a person
// pastes works in real git, which an in-memory twin cannot show. An inherited
// GIT_DIR would commit into the real repository; the user's git config would
// change the exact output lines compared.
const gitEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  env.GIT_CONFIG_GLOBAL = "/dev/null"
  env.GIT_CONFIG_NOSYSTEM = "1"
  return env
}

const scratchDirs: string[] = []
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const scratchRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-grep-"))
  scratchDirs.push(dir)
  const env = gitEnv()
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { cwd: dir, env },
    )
  return { dir, env, git }
}

describe("summaryPrompt", () => {
  it("puts the total and every model's cost on a line of its own", () => {
    const prompt = summaryPrompt({
      entryCommit: "e",
      processBase: "b",
      processTip: "t",
      humanCommits: [],
      processCost: 12,
      processCostByModel: [
        { model: "smart", cost: 5 },
        { model: "base", cost: 7 },
      ],
      marks: [],
      vars: {},
      env: {},
    })
    expect(prompt).toContain("Token cost: 12\n- smart: 5\n- base: 7\n\nPrint the closing message")
  })

  const base = {
    entryCommit: "e",
    processBase: "b",
    processTip: "t",
    humanCommits: [],
    processCost: 0,
    processCostByModel: [],
    marks: [],
    vars: {},
    env: {},
  }

  it("with no marks leaves today's text", () => {
    expect(summaryPrompt(base)).toContain("Token cost: 0\n\nPrint the closing message")
    expect(summaryPrompt(base)).not.toContain("Risk tier")
    expect(summaryPrompt(base)).not.toContain("Production signals")
  })

  it("adds the one no-mentions line, naming the flag, for flag-mentions=0", () => {
    const prompt = summaryPrompt({
      ...base,
      vars: { flag: "alpha" },
      marks: [{ name: "flag-mentions", value: "0" }],
    })
    expect(prompt).toContain("Flag `alpha`: no line outside the registry names it.")
  })

  const listedMentions = Array.from({ length: 50 }, (_, i) => ({
    name: "flag-mention",
    value: `README.md:${i + 1}`,
  }))

  it("lists the flag-mention values as data, then says how many more there are", () => {
    const prompt = summaryPrompt({
      ...base,
      vars: { flag: "alpha", flagRegistry: "src/flags/index.ts" },
      marks: [{ name: "flag-mentions", value: "53" }, ...listedMentions],
    })
    expect(prompt).toContain("naming flag `alpha`")
    expect(prompt).toContain("- `README.md:1`\n")
    expect(prompt).toContain("- `README.md:50`\n")
    expect(prompt).toContain(
      "…and 3 more: `git grep --full-name -niIE '(^|[^a-z0-9_])(gtd_flag_|flag_)?alpha([^a-z0-9_]|$)' -- ':(top)' ':(top,exclude,literal)src/flags/index.ts' ':(top,exclude).gtd'`",
    )
  })

  it("escapes regex metacharacters in the more-hint and strips quotes and backticks", () => {
    const prompt = summaryPrompt({
      ...base,
      vars: { flag: "a.b", flagRegistry: "src/flags/index.ts" },
      marks: [{ name: "flag-mentions", value: "53" }, ...listedMentions],
    })
    const command = /more: `(git grep [^`]+)`/.exec(prompt)?.[1] ?? ""
    expect(command).toContain("a\\.b")
    const quoted = summaryPrompt({
      ...base,
      vars: { flag: "a'b`c", flagRegistry: "src/flags/index.ts" },
      marks: [{ name: "flag-mentions", value: "53" }, ...listedMentions],
    })
    expect(/more: `(git grep [^`]+)`/.exec(quoted)?.[1]).toContain("?abc(")
  })

  it("shell-quotes a registry path holding a quote, and the command still runs", () => {
    const prompt = summaryPrompt({
      ...base,
      vars: { flag: "alpha", flagRegistry: "config/it's flags.ts" },
      marks: [{ name: "flag-mentions", value: "53" }, ...listedMentions],
    })
    const command = /more: `(git grep [^`]+)`/.exec(prompt)?.[1] ?? ""
    expect(command).toContain(`':(top,exclude,literal)config/it'\\''s flags.ts'`)
    const { dir, env, git } = scratchRepo()
    git("init", "-q")
    // git grep exits 1 for no match; 128 would be a rejected pathspec
    expect(() =>
      execFileSync("sh", ["-c", `${command}; test $? -le 1`], { cwd: dir, env }),
    ).not.toThrow()
  })

  it("prints a git grep hint that finds all three mention forms in tracked files only", () => {
    const prompt = summaryPrompt({
      ...base,
      vars: { flag: "alpha", flagRegistry: "src/flags/index.ts" },
      marks: [{ name: "flag-mentions", value: "2" }],
    })
    const command = /more: `(git grep [^`]+)`/.exec(prompt)?.[1] ?? ""
    const { dir, env, git } = scratchRepo()
    mkdirSync(join(dir, "src/flags"), { recursive: true })
    mkdirSync(join(dir, ".gtd"))
    writeFileSync(
      join(dir, "a.md"),
      "GTD_FLAG_ALPHA=1\nflag_alpha\nThe alpha flag\nalphabet\nmy_alpha\n",
    )
    writeFileSync(join(dir, "src/flags/index.ts"), "alpha\n")
    writeFileSync(join(dir, ".gtd/TODO.md"), "alpha\n")
    writeFileSync(join(dir, "untracked.md"), "alpha\n")
    writeFileSync(join(dir, "bin.dat"), "alpha\u0000\n")
    git("init", "-q")
    git("add", "a.md", "bin.dat", "src/flags/index.ts")
    git("add", "-f", ".gtd/TODO.md")
    git("commit", "-q", "-m", "init")
    const expected = ["a.md:1:GTD_FLAG_ALPHA=1", "a.md:2:flag_alpha", "a.md:3:The alpha flag"]
    // from a subdirectory the hint must still search the whole repository
    for (const cwd of [dir, join(dir, "src")]) {
      const out = execFileSync("sh", ["-c", `${command}; test $? -le 1`], { cwd, env }).toString()
      expect(out.trim().split("\n")).toEqual(expected)
    }
  })

  describe("with no usable flagRegistry", () => {
    const run = (vars: Record<string, string>) => {
      const prompt = summaryPrompt({
        ...base,
        vars: { flag: "alpha", ...vars },
        marks: [{ name: "flag-mentions", value: "53" }, ...listedMentions],
      })
      const command = /more: `(git grep [^`]+)`/.exec(prompt)?.[1] ?? ""
      const { dir, env, git } = scratchRepo()
      mkdirSync(join(dir, "src/flags"), { recursive: true })
      writeFileSync(join(dir, "a.md"), "The alpha flag\n")
      writeFileSync(join(dir, "src/flags/index.ts"), "alpha\n")
      git("init", "-q")
      git("add", "a.md", "src/flags/index.ts")
      git("commit", "-q", "-m", "init")
      const out = execFileSync("sh", ["-c", `${command}; test $? -le 1`], { cwd: dir, env })
      return { command, out: out.toString().trim() }
    }

    it("falls back to the default registry when the var is unset", () => {
      const { out } = run({})
      expect(out).toBe("a.md:1:The alpha flag")
    })

    it("falls back to the default registry when the var is empty, never an empty exclude", () => {
      const { command, out } = run({ flagRegistry: "" })
      expect(command).toContain("':(top,exclude,literal)src/flags/index.ts'")
      expect(command).not.toContain("':(top,exclude,literal)'")
      expect(out).toBe("a.md:1:The alpha flag")
    })
  })

  it("says nothing of more when every mention is listed", () => {
    const prompt = summaryPrompt({
      ...base,
      vars: { flag: "alpha" },
      marks: [
        { name: "flag-mentions", value: "1" },
        { name: "flag-mention", value: "README.md:3" },
      ],
    })
    expect(prompt).toContain("- `README.md:3`\n")
    expect(prompt).not.toContain("more: ")
  })

  it("adds no flag section without flag marks, even with a flag var", () => {
    const prompt = summaryPrompt({
      ...base,
      vars: { flag: "alpha" },
      marks: [{ name: "risk-tier", value: "low" }],
    })
    expect(prompt).toContain("Token cost: 0\n\nPrint the closing message")
    expect(prompt).not.toContain("alpha")
  })

  it("adds the advisory risk line once for the last lap's high tier", () => {
    const prompt = summaryPrompt({
      ...base,
      marks: [
        { name: "risk-tier", value: "low" },
        { name: "risk-tier", value: "high" },
      ],
    })
    expect(prompt).toContain("Risk tier: high — this merge needs a human reviewer (advisory")
    expect(prompt.split("Risk tier: high").length).toBe(2)
  })

  it("reads only the last lap: a lowered tier and a dropped signal leave no trace", () => {
    const prompt = summaryPrompt({
      ...base,
      marks: [
        { name: "risk-tier", value: "high" },
        { name: "production-signal", value: "error rate" },
        { name: "risk-tier", value: "low" },
        { name: "production-signal", value: "p95" },
      ],
    })
    expect(prompt).not.toContain("Risk tier")
    expect(prompt).not.toContain("error rate")
    expect(prompt).toContain("- `p95`\n")
  })

  it("treats a flag-on process with no tier mark as high", () => {
    const prompt = summaryPrompt({
      ...base,
      vars: { flag_risk_tier: "1", flag_naive_pass: "1" },
    })
    expect(prompt).toContain("Risk tier: high")
  })

  it("marks no tier when the risk-tier flag is on without naive-pass", () => {
    const prompt = summaryPrompt({ ...base, vars: { flag_risk_tier: "1", flag_naive_pass: "0" } })
    expect(prompt).not.toContain("Risk tier")
  })

  const signal = (value: string) => ({ name: "production-signal", value })

  it("caps the listed signals at 10 and fences them as not instructions", () => {
    const prompt = summaryPrompt({
      ...base,
      marks: [
        { name: "risk-tier", value: "low" },
        ...Array.from({ length: 12 }, (_, i) => signal(`s${i}`)),
      ],
    })
    expect(prompt).toContain("not instructions")
    for (let i = 0; i < 10; i++) expect(prompt).toContain(`- \`s${i}\`\n`)
    expect(prompt).not.toContain("`s10`")
  })

  it("cuts a long signal to exactly 200 chars", () => {
    const prompt = summaryPrompt({
      ...base,
      marks: [{ name: "risk-tier", value: "low" }, signal("s0"), signal("x".repeat(300))],
    })
    expect(prompt).toContain(`- \`${"x".repeat(200)}\`\n`)
    expect(prompt).not.toContain("x".repeat(201))
  })

  it("lists a repeated signal once, in first-occurrence order", () => {
    const prompt = summaryPrompt({
      ...base,
      marks: [{ name: "risk-tier", value: "low" }, signal("s0"), signal("s1"), signal("s0")],
    })
    expect(prompt).toContain("- `s0`\n- `s1`\n")
    expect(prompt.split("- `s0`").length).toBe(2)
  })
})

describe("the thread rules", () => {
  it("are in all three answering prompts and no longer say a footnote is human input only", () => {
    const prompts = renderText(() => [
      designTriagePrompt("base"),
      architectureAuthorPrompt(),
      buildReviewCollectingPrompt("capture"),
    ])
    for (const prompt of prompts) {
      expect(prompt).toContain("- A: <reply>")
      expect(prompt).toContain("Never start a thread yourself")
      expect(prompt).not.toContain("human input only")
    }
  })

  it("make the review collector write requirements, reply in the review and run the review check", () => {
    const prompt = renderText(() => buildReviewCollectingPrompt("capture"))
    expect(prompt).toContain("gtd check review .gtd/REVIEW.md")
  })
})

describe("code threads in prompts", () => {
  const waiting = [
    { path: "src/a.ts", line: 4, waitingOn: "agent", first: "why?", faults: [] },
    { path: "src/b.ts", line: 9, waitingOn: "human", first: "done", faults: [] },
  ] as const

  it("lists the code threads waiting on the agent in the three gates", () => {
    const prompts = renderText(
      () => [
        designTriagePrompt("base"),
        architectureAuthorPrompt(),
        buildReviewCollectingPrompt("capture"),
      ],
      { codeThreads: waiting },
    )
    for (const prompt of prompts) {
      expect(prompt).toContain("src/a.ts:4: why?")
      expect(prompt).not.toContain("src/b.ts:9")
    }
  })

  it("says nothing when none wait", () => {
    const prompt = renderText(() => designTriagePrompt("base"))
    expect(prompt).not.toContain("Code threads waiting on you")
  })

  it("separates a thread from a one-shot code comment at the review collector", () => {
    const prompt = renderText(() => buildReviewCollectingPrompt("capture"))
    expect(prompt).toContain("exactly one `A:` comment line")
    expect(prompt).toContain("one-shot")
  })

  it("teaches the syntax once in the footnote rules", () => {
    for (const message of renderText(() => [
      designGateAnswerMessage(),
      architectureGateAnswerMessage(),
      buildReviewAwaitReviewMessage("base"),
    ])) {
      expect(message).toContain("gtd check --open-threads")
      expect(message).toContain("phone UI does not show them")
    }
  })
})

describe("buildReviewReviewingPrompt risk marking", () => {
  it("states the Risk: marker rule and the re-review rule", () => {
    const prompt = renderText(() => buildReviewReviewingPrompt("base"))
    expect(prompt).toContain("Open a hunk's note with `Risk:` only for a concrete defect")
    expect(prompt).toContain("never a style remark")
    expect(prompt).toContain("describe what the fix changed under the")
    expect(prompt).toContain("re-mark only a risk the fix did not resolve")
  })
})

describe("deferNotesScript", () => {
  const run = (notes: Parameters<typeof deferNotesScript>[0], existing?: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "defer-"))
    mkdirSync(join(dir, ".gtd"))
    if (existing !== undefined) writeFileSync(join(dir, ".gtd/TODO.md"), existing)
    execFileSync("sh", ["-c", deferNotesScript(notes, "abcdef1234567890")], { cwd: dir })
    return readFileSync(join(dir, ".gtd/TODO.md"), "utf8")
  }
  const notes = [{ id: "note-1", anchor: "a.ts:3", text: "plain", label: "could: tiny" }]

  it("creates the file with one section headed by the round's short sha", () => {
    expect(run(notes)).toBe(
      "## Deferred review notes (abcdef1)\n\n- note-1 — a.ts:3 (could: tiny): plain\n",
    )
  })

  it("appends after a blank line, never truncating", () => {
    const out = run(notes, "# Sketch\n\nkeep me\n")
    expect(out.startsWith("# Sketch\n\nkeep me\n\n## Deferred review notes (abcdef1)\n")).toBe(true)
  })

  it("separates from a file lacking a trailing newline", () => {
    expect(run(notes, "keep")).toContain("keep\n\n## Deferred")
  })

  it("lands quotes, dollars and backticks verbatim", () => {
    const text = 'it\'s $HOME `x` "q" \\n'
    const out = run([{ id: "note-1", anchor: "a", text }])
    expect(out).toContain(text)
  })

  it("is an oxfmt fixed point, for a note longer than one line", () => {
    const long = [
      {
        id: "note-3",
        anchor: "Parser accepts CRLF ./src/parse.ts#30-31",
        text: "rename the helper to something clearer please",
        label: "could",
      },
    ]
    const dir = mkdtempSync(join(tmpdir(), "fmt-"))
    const file = join(dir, "TODO.md")
    writeFileSync(file, run(long, "# Sketch\n"))
    execFileSync("npx", ["oxfmt", "--check", file], { cwd: process.cwd() })
  })
})

describe("severity wording", () => {
  it("triage message names the four severity ids", () => {
    const m = renderText(() => buildReviewTriageMessage())
    for (const id of ["note-<n>.security", ".reversibility", ".blastRadius", ".newConcept"])
      expect(m).toContain(id)
  })

  it("collecting prompt keeps capture order and carries labels", () => {
    const p = renderText(() => buildReviewCollectingPrompt("capture"))
    expect(p).toContain("capture order")
    expect(p).toContain("(tier: reason)")
  })

  it("design triage parks deferred review notes", () => {
    expect(renderText(() => designTriagePrompt("base"))).toContain("## Deferred review notes")
  })
})

describe("deferNotesScript — the in-memory recognizer agrees with the real sh script", () => {
  const notes = [
    { id: "note-1", anchor: "a.ts:3", text: 'it\'s $HOME `x` "q" 100%', label: "could" },
    {
      id: "note-2",
      anchor: "Parser accepts CRLF ./src/parse.ts#30-31",
      text: "rename the helper to something clearer please",
      label: "could",
    },
  ]
  const cases: [string, string | undefined][] = [
    ["no file", undefined],
    ["an empty file", ""],
    ["a file without a trailing newline", "keep"],
    ["a file with a trailing newline", "# Sketch\n\nkeep\n"],
  ]

  it.each(cases)("%s", (_name, existing) => {
    const script = deferNotesScript(notes, "abcdef1234567890")
    const dir = mkdtempSync(join(tmpdir(), "defer-contract-"))
    if (existing !== undefined) {
      mkdirSync(join(dir, ".gtd"))
      writeFileSync(join(dir, ".gtd/TODO.md"), existing)
    }
    execFileSync("sh", ["-c", script], { cwd: dir })
    const real = readFileSync(join(dir, ".gtd/TODO.md"), "utf8")

    const repo = new InMemRepo()
    if (existing !== undefined) repo.writeFile(".gtd/TODO.md", existing)
    expect(applyEmittedScript(repo, new Map(), script).ok).toBe(true)
    expect(repo.readFile(".gtd/TODO.md")).toBe(real)
  })
})

describe("buildReviewReviewingPrompt scenarios", () => {
  it("names each removed assertion and asks for a Weakened: note", () => {
    const prompt = renderText(() =>
      buildReviewReviewingPrompt("base", undefined, [
        {
          path: "e2e/a.feature",
          lines: [{ scenario: "Scenario: shown", line: "Then it is shown" }],
        },
      ]),
    )
    expect(prompt).toContain("e2e/a.feature — Scenario: shown — Then it is shown")
    expect(prompt).toContain("`Weakened:`")
  })

  it("asks for no Weakened: note when nothing was removed", () => {
    const prompt = renderText(() => buildReviewReviewingPrompt("base"))
    expect(prompt).toContain("## Scenarios")
    expect(prompt).not.toContain("Weakened:")
  })
})

describe("the seam phase's texts", () => {
  const rejection = { strays: ["src/flows/helpers.ts", "src/flows/runtime.ts"], p: 0.85 }

  it("asks the first naive pass for the quickest working change, with no rejection", () => {
    const prompt = renderText(() => naivePassPrompt())
    expect(prompt).toContain(".gtd/REQUIREMENTS.md")
    expect(prompt).not.toContain("rejected")
  })

  it("names the reject verdict, its p, every stray and the criterion on a retry", () => {
    const prompt = renderText(() => naivePassPrompt(rejection))
    expect(prompt).toContain("reject")
    expect(prompt).toContain("0.85")
    expect(prompt).toContain("`src/flows/helpers.ts`")
    expect(prompt).toContain("`src/flows/runtime.ts`")
    expect(prompt).toContain("solved the task the wrong way")
  })

  it("cites the reference as reading material only and asks for a new release flag", () => {
    const prompt = renderText(() => implementBuildingPrompt("abc123"))
    expect(prompt).toContain("git show abc123")
    expect(prompt).toContain("never apply")
    expect(prompt).toContain("release flag")
  })

  it("high and undefined tiers carry the flag bullet; low says to add none", () => {
    const base = renderText(() => implementBuildingPrompt("abc123"))
    expect(renderText(() => implementBuildingPrompt("abc123", "high"))).toBe(base)
    expect(base).toContain("new release flag")
    const low = renderText(() => implementBuildingPrompt("abc123", "low"))
    expect(low).toContain("Add no release flag — this change is low risk tier")
    expect(low).not.toContain("new release flag")
    expect(low).toContain("git show abc123")
  })

  it("keeps a fix turn to the feedback file's rules", () => {
    expect(renderText(() => implementFixPrompt())).toContain(".gtd/FEEDBACK.md")
  })

  it("names both steer answers and the overrule risk, and lists every stray", () => {
    const message = renderText(() => seamSteerMessage(rejection))
    expect(message).toContain("edit `.gtd/REQUIREMENTS.md`")
    expect(message).toContain("clean")
    expect(message).toContain("Overrule")
    expect(message).toContain("unaddressed")
    expect(message).toContain("src/flows/helpers.ts")
  })

  it("names every unreadable path for a by-hand landing", () => {
    const message = renderText(() =>
      seamByHandMessage(["vendor/a.bin", "src/flows/helpers.ts"], ["vendor/a.bin"], "abc123"),
    )
    expect(message).toContain("`vendor/a.bin` (unreadable)")
    expect(message).toContain("`src/flows/helpers.ts`\n")
    expect(message).toContain("git show abc123 --")
  })

  it("keeps a stray path with a newline on one line", () => {
    const message = renderText(() => seamSteerMessage({ strays: ["a\nb.ts"], p: 0.9 }))
    expect(message).toContain('`"a\\nb.ts"`')
    expect(message).not.toContain("a\nb.ts")
  })
})
