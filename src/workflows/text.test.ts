import { describe, expect, it } from "vitest"
import {
  buildReviewReviewingPrompt,
  agentWithSkills,
  architectureAuthorPrompt,
  architectureGateAnswerMessage,
  buildFixQualityPrompt,
  buildQualityReviewingPrompt,
  buildReviewAwaitReviewMessage,
  buildReviewCollectingPrompt,
  designGateAnswerMessage,
  designTriagePrompt,
  summaryPrompt,
  withSkills,
} from "./text.js"
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
      vars: {},
      env: {},
    })
    expect(prompt).toContain("Token cost: 12\n- smart: 5\n- base: 7\n\nPrint the closing message")
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
