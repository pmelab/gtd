import { describe, expect, it } from "vitest"
import {
  FREE_TEXT_PLACEHOLDER,
  parseOpenQuestions,
  unansweredQuestions,
  toggleCheckbox,
  QA_FORMAT,
} from "./OpenQuestions.js"

describe("parseOpenQuestions", () => {
  it("returns zero questions and zero errors when there is no questions section", () => {
    expect(parseOpenQuestions("# Plan\n\nBuild a calculator.\n")).toEqual({
      questions: [],
      errors: [],
    })
  })

  it("returns zero questions and zero errors when the Open Questions section is present but empty", () => {
    expect(parseOpenQuestions("# Plan\n\nBuild a calculator.\n\n## Open Questions\n")).toEqual({
      questions: [],
      errors: [],
    })
  })

  it("parses a single open question with a free-form body (no options)", () => {
    const content = [
      "# Plan",
      "",
      "Build a calculator.",
      "",
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "add and subtract.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content)).toEqual({
      questions: [
        {
          question: "Which operations?",
          status: "open",
          text: "add and subtract.",
          headingLine: 6,
          options: [],
          answered: false,
        },
      ],
      errors: [],
    })
  })

  it("marks questions under ## Answered Questions as answered-status prose (no options)", () => {
    const content = [
      "## Answered Questions",
      "",
      "### Which operations?",
      "",
      "add, subtract, and multiply.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content)).toEqual({
      questions: [
        {
          question: "Which operations?",
          status: "answered",
          text: "add, subtract, and multiply.",
          headingLine: 2,
          options: [],
          answered: false,
        },
      ],
      errors: [],
    })
  })

  it("accepts an open question with an empty body", () => {
    const content = ["## Open Questions", "", "### Which operations?", ""].join("\n")
    expect(parseOpenQuestions(content)).toEqual({
      questions: [
        {
          question: "Which operations?",
          status: "open",
          text: "",
          headingLine: 2,
          options: [],
          answered: false,
        },
      ],
      errors: [],
    })
  })

  it("stops a questions section at the next H2 heading", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "add and subtract.",
      "",
      "## Implementation Notes",
      "",
      "### Not a question",
      "",
      "This should be ignored entirely.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content)).toEqual({
      questions: [
        {
          question: "Which operations?",
          status: "open",
          text: "add and subtract.",
          headingLine: 2,
          options: [],
          answered: false,
        },
      ],
      errors: [],
    })
  })

  it("errors on a bare `###` heading with no question text", () => {
    const content = ["## Open Questions", "", "###", "", "some body.", ""].join("\n")
    const result = parseOpenQuestions(content)
    expect(result.questions).toEqual([])
    expect(result.errors).toEqual([
      "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
    ])
  })

  it("keeps well-formed questions while collecting the empty-heading error", () => {
    const content = [
      "## Open Questions",
      "",
      "###",
      "",
      "### Real question?",
      "",
      "an answer.",
      "",
    ].join("\n")
    const result = parseOpenQuestions(content)
    expect(result.questions).toEqual([
      {
        question: "Real question?",
        status: "open",
        text: "an answer.",
        headingLine: 4,
        options: [],
        answered: false,
      },
    ])
    expect(result.errors).toHaveLength(1)
  })

  describe("checkbox options", () => {
    const q = (lines: readonly string[]): string =>
      ["## Open Questions", "", "### Which API?", ...lines, ""].join("\n")

    it("parses two agent options plus a trailing free-text slot, none ticked = unanswered", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] REST", "- [ ] GraphQL", `- [ ] ${FREE_TEXT_PLACEHOLDER}`]),
      )
      const [question] = result.questions
      expect(question!.options).toEqual([
        { checked: false, text: "REST", freeText: false, sourceLine: 4, endLine: 4 },
        { checked: false, text: "GraphQL", freeText: false, sourceLine: 5, endLine: 5 },
        { checked: false, text: "", freeText: true, sourceLine: 6, endLine: 6 },
      ])
      expect(question!.answered).toBe(false)
    })

    it("is answered when exactly one agent option is ticked", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] REST", "- [x] GraphQL", `- [ ] ${FREE_TEXT_PLACEHOLDER}`]),
      )
      expect(result.questions[0]!.answered).toBe(true)
    })

    it("is unanswered when two options are ticked (ambiguous)", () => {
      const result = parseOpenQuestions(
        q(["", "- [x] REST", "- [x] GraphQL", `- [ ] ${FREE_TEXT_PLACEHOLDER}`]),
      )
      expect(result.questions[0]!.answered).toBe(false)
    })

    it("is answered when the free-text slot is ticked WITH text, capturing that text", () => {
      const result = parseOpenQuestions(q(["", "- [ ] REST", "- [ ] GraphQL", "- [x] use tRPC"]))
      const question = result.questions[0]!
      expect(question.answered).toBe(true)
      const chosen = question.options.find((o) => o.checked)!
      expect(chosen).toEqual({
        checked: true,
        text: "use tRPC",
        freeText: true,
        sourceLine: 6,
        endLine: 6,
      })
    })

    it("is unanswered when the free-text slot is ticked but still the placeholder", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] REST", "- [ ] GraphQL", `- [x] ${FREE_TEXT_PLACEHOLDER}`]),
      )
      const question = result.questions[0]!
      expect(question.answered).toBe(false)
      expect(question.options[2]).toEqual({
        checked: true,
        text: "",
        freeText: true,
        sourceLine: 6,
        endLine: 6,
      })
    })

    it("accepts `* [X]` bullet/upper-case tick syntax", () => {
      const result = parseOpenQuestions(q(["", "* [ ] REST", "* [X] GraphQL"]))
      expect(result.questions[0]!.answered).toBe(true)
    })

    it("only normalizes the placeholder on the LAST option", () => {
      // A non-last option literally equal to the placeholder is NOT the free-text
      // slot, so it is not normalized to "".
      const result = parseOpenQuestions(
        q(["", `- [ ] ${FREE_TEXT_PLACEHOLDER}`, "- [ ] real free text"]),
      )
      const [first, last] = result.questions[0]!.options
      expect(first).toEqual({
        checked: false,
        text: FREE_TEXT_PLACEHOLDER,
        freeText: false,
        sourceLine: 4,
        endLine: 4,
      })
      expect(last!.freeText).toBe(true)
    })

    it("carries no options for an answered-section question even if it has checkbox-looking lines", () => {
      const content = ["## Answered Questions", "", "### Which API?", "", "Use tRPC.", ""].join(
        "\n",
      )
      const question = parseOpenQuestions(content).questions[0]!
      expect(question.options).toEqual([])
      expect(question.answered).toBe(false)
    })
  })

  describe("section ordering", () => {
    it("reports a finding when a '##' section precedes '## Open Questions'", () => {
      const content = [
        "## Implementation Notes",
        "",
        "some notes.",
        "",
        "## Open Questions",
        "",
        "### Which operations?",
        "",
        "add and subtract.",
        "",
      ].join("\n")
      expect(parseOpenQuestions(content).errors).toEqual([
        "A '##' section appears before '## Open Questions', which must come first",
      ])
    })

    it("reports a finding when a '##' section follows '## Answered Questions'", () => {
      const content = [
        "## Answered Questions",
        "",
        "### Already resolved?",
        "",
        "Yes.",
        "",
        "## Implementation Notes",
        "",
        "some notes.",
        "",
      ].join("\n")
      expect(parseOpenQuestions(content).errors).toEqual([
        "A '##' section appears after '## Answered Questions', which must come last",
      ])
    })

    it("reports at most one 'before' finding even with multiple sections preceding Open Questions", () => {
      const content = [
        "## Implementation Notes",
        "",
        "some notes.",
        "",
        "## Constraints",
        "",
        "some constraints.",
        "",
        "## Open Questions",
        "",
        "### Which operations?",
        "",
        "add and subtract.",
        "",
      ].join("\n")
      expect(parseOpenQuestions(content).errors).toEqual([
        "A '##' section appears before '## Open Questions', which must come first",
      ])
    })

    it("reports both findings when '## Answered Questions' comes before '## Open Questions'", () => {
      const content = [
        "## Answered Questions",
        "",
        "### Already resolved?",
        "",
        "Yes.",
        "",
        "## Open Questions",
        "",
        "### Which operations?",
        "",
        "add and subtract.",
        "",
      ].join("\n")
      expect(parseOpenQuestions(content).errors).toEqual([
        "A '##' section appears before '## Open Questions', which must come first",
        "A '##' section appears after '## Answered Questions', which must come last",
      ])
    })

    it("reports no ordering finding with only '## Open Questions' present", () => {
      const content = ["## Open Questions", "", "### Which operations?", "", "add.", ""].join("\n")
      expect(parseOpenQuestions(content).errors).toEqual([])
    })

    it("reports no ordering finding with only '## Answered Questions' present", () => {
      const content = ["## Answered Questions", "", "### Already resolved?", "", "Yes.", ""].join(
        "\n",
      )
      expect(parseOpenQuestions(content).errors).toEqual([])
    })

    it("reports no ordering finding when neither section is present", () => {
      const content = ["## Implementation Notes", "", "some notes.", ""].join("\n")
      expect(parseOpenQuestions(content).errors).toEqual([])
    })

    it("reports no finding for lead prose and a level-1 title above '## Open Questions'", () => {
      const content = [
        "# Plan",
        "",
        "Some lead prose describing the plan.",
        "",
        "## Open Questions",
        "",
        "### Which operations?",
        "",
        "add and subtract.",
        "",
      ].join("\n")
      expect(parseOpenQuestions(content).errors).toEqual([])
    })
  })

  describe("option line span (endLine)", () => {
    const q = (lines: readonly string[]): string =>
      ["## Open Questions", "", "### Which API?", ...lines, ""].join("\n")

    it("a single-line option's endLine equals its own sourceLine", () => {
      const result = parseOpenQuestions(q(["", "- [ ] REST", "- [ ] GraphQL"]))
      const [rest, graphql] = result.questions[0]!.options
      expect(rest).toMatchObject({ sourceLine: 4, endLine: 4 })
      expect(graphql).toMatchObject({ sourceLine: 5, endLine: 5 })
    })

    it("an indented wrap over two continuation lines extends endLine to the last one", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] REST, specifically", "  a JSON:API-flavored", "  REST endpoint set"]),
      )
      const [option] = result.questions[0]!.options
      expect(option).toMatchObject({ sourceLine: 4, endLine: 6 })
    })

    it("an unindented (lazy) wrap gets the same span as an indented one", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] REST, specifically", "a JSON:API-flavored", "REST endpoint set"]),
      )
      const [option] = result.questions[0]!.options
      expect(option).toMatchObject({ sourceLine: 4, endLine: 6 })
    })

    it("the next checkbox line ends the previous option's span", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] REST, specifically", "a wrapped line", "- [ ] GraphQL"]),
      )
      const [rest, graphql] = result.questions[0]!.options
      expect(rest).toMatchObject({ sourceLine: 4, endLine: 5 })
      expect(graphql).toMatchObject({ sourceLine: 6, endLine: 6 })
    })

    it("a blank line ends the span, so trailing prose after it stays out of the last option's span", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] _your answer_", "a wrapped answer", "", "some trailing prose"]),
      )
      const [option] = result.questions[0]!.options
      expect(option).toMatchObject({ sourceLine: 4, endLine: 5 })
    })

    it("the last body line ends the span at the block end, with no overrun past the next heading", () => {
      const content = [
        "## Open Questions",
        "",
        "### Which API?",
        "",
        "- [ ] REST",
        "a wrapped line",
        "another wrapped line",
      ].join("\n")
      const result = parseOpenQuestions(content)
      const [option] = result.questions[0]!.options
      expect(option).toMatchObject({ sourceLine: 4, endLine: 6 })
    })

    it("answered/text stay derived from the checkbox line alone for a wrapped ticked free-text option", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] REST", "- [x] use tRPC", "a wrapped continuation of the answer"]),
      )
      const question = result.questions[0]!
      expect(question.answered).toBe(true)
      const chosen = question.options.find((o) => o.checked)!
      expect(chosen).toMatchObject({ text: "use tRPC", sourceLine: 5, endLine: 6 })
    })
  })
})

describe("unansweredQuestions", () => {
  it("returns only OPEN questions that are not answered", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [x] GraphQL",
      "",
      "### Which database?",
      "",
      "- [ ] Postgres",
      "- [ ] MySQL",
      "",
      "## Answered Questions",
      "",
      "### Already resolved?",
      "",
      "Yes.",
      "",
    ].join("\n")
    const unanswered = unansweredQuestions(content)
    expect(unanswered.map((q) => q.question)).toEqual(["Which database?"])
  })

  it("returns an empty array when every open question is answered", () => {
    const content = ["## Open Questions", "", "### Which API?", "", "- [x] REST", ""].join("\n")
    expect(unansweredQuestions(content)).toEqual([])
  })
})

describe("toggleCheckbox", () => {
  const doc = [
    "## Open Questions",
    "",
    "### Which API?",
    "",
    "- [ ] REST",
    "- [x] GraphQL",
    "",
  ].join("\n")

  it("flips an unchecked box to checked", () => {
    expect(toggleCheckbox(doc, 4)?.newText).toBe("x")
  })

  it("flips a checked box to unchecked", () => {
    expect(toggleCheckbox(doc, 5)?.newText).toBe(" ")
  })

  it("returns undefined for a line with no list-marker checkbox", () => {
    expect(toggleCheckbox(doc, 3)).toBeUndefined() // blank line
  })

  it("does not fire on a `[x]` bracket pair inside prose with no list marker (unlike the old bare-bracket regex)", () => {
    expect(toggleCheckbox("some prose with a [x] bracket pair", 0)).toBeUndefined()
  })
})

describe("QA_FORMAT", () => {
  const questionsDoc = [
    "# Plan",
    "",
    "## Open Questions",
    "",
    "### Which operations?",
    "",
    "add and subtract.",
    "",
    "## Answered Questions",
    "",
    "### What is the target platform?",
    "",
    "web only.",
    "",
  ].join("\n")

  it("validate delegates to parseOpenQuestions's errors, each wrapped as a positionless finding", () => {
    const malformed = ["## Open Questions", "", "###", "", "no question text.", ""].join("\n")
    expect(QA_FORMAT.validate(malformed)).toEqual([
      {
        message:
          "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
      },
    ])
    expect(QA_FORMAT.validate(questionsDoc)).toEqual([])
  })

  it("outline marks a prose (option-less) open question as unanswered, and answered-section questions as answered", () => {
    const nodes = QA_FORMAT.outline(questionsDoc)
    expect(nodes.map((n) => n.name)).toEqual([
      "[unanswered] Which operations?",
      "[answered] What is the target platform?",
    ])
    expect(nodes[0]?.selectionRange.start.line).toBe(4)
    expect(nodes[1]?.selectionRange.start.line).toBe(10)
  })

  it("outline marks an open question with exactly one ticked option as answered, and lists options as leaf children", () => {
    const doc = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [x] GraphQL",
      "- [ ] _your answer_",
      "",
    ].join("\n")
    const nodes = QA_FORMAT.outline(doc)
    expect(nodes[0]?.name).toBe("[answered] Which API?")
    expect(nodes[0]?.children?.map((c) => c.name)).toEqual([
      "[ ] REST",
      "[x] GraphQL",
      "[ ] your answer",
    ])
    expect(nodes[0]?.children?.every((c) => c.leaf === true)).toBe(true)
  })

  it("outline returns no nodes when there is no Open Questions section", () => {
    expect(QA_FORMAT.outline("# Plan\n\nJust prose.\n")).toEqual([])
  })

  it("actions offer 'pick this option' on an unticked option, checking it and unticking the ticked sibling", () => {
    const doc = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [x] GraphQL",
      "- [ ] _your answer_",
      "",
    ].join("\n")
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const actions = QA_FORMAT.actions(doc, at(4)) // the REST line
    const pick = actions.find((a) => a.title === "gtd: pick this option")
    expect(pick).toBeDefined()
    const edits = pick?.edits ?? []
    expect(edits.map((e) => e.range.start.line).sort()).toEqual([4, 5])
    expect(edits.find((e) => e.range.start.line === 4)?.newText).toBe("x")
    expect(edits.find((e) => e.range.start.line === 5)?.newText).toBe(" ")
  })

  it("actions offer 'uncheck this option' on the already-ticked option, and only 'add a footnote' off an option line", () => {
    const doc = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [x] GraphQL",
      "- [ ] _your answer_",
      "",
    ].join("\n")
    const at = (line: number) => ({ start: { line, character: 0 }, end: { line, character: 0 } })
    const actions = QA_FORMAT.actions(doc, at(5))
    const uncheck = actions.find((a) => a.title === "gtd: uncheck this option")
    expect(uncheck?.edits).toHaveLength(1)
    expect(QA_FORMAT.actions(doc, at(2)).map((a) => a.title)).toEqual(["gtd: add a footnote"]) // the ### heading
  })

  it("has a pointerAt (footnote jumps only)", () => {
    expect(QA_FORMAT.pointerAt).toBeDefined()
  })
})

describe("voice styling (styled qa exemplar)", () => {
  // Voice check (src/workflows/unified.yaml's styleBlock): blunt, imperative
  // sentences, bold carrying the actual claim, no throat-clearing preamble.
  // This proves the parser cares only about the heading/checkbox grammar,
  // never the prose register wrapped around it.
  const styledUnticked = [
    "# Requirements",
    "",
    "**Ship rate limiting on the public API before the next release.** Every",
    "unauthenticated endpoint gets a token-bucket limiter; every authenticated",
    "endpoint gets a higher ceiling keyed by account. No endpoint ships without",
    "one.",
    "",
    "## Open Questions",
    "",
    "### What is the limiter's time window?",
    "",
    "**A fixed window undercounts bursts at its boundary.** Pick the algorithm",
    "now — retrofitting it once clients depend on the numbers costs a",
    "migration, not a config change.",
    "",
    "- [ ] Fixed window, reset every 60 seconds",
    "- [ ] Sliding window log, no reset boundary",
    "- [ ] _your answer_",
    "",
    "### Where does the limiter store its counters?",
    "",
    "**Redis is the default. Don't reach for anything heavier.** A single",
    "shared store keeps every API instance's count consistent under one",
    "config.",
    "",
    "- [ ] Redis, one shared instance",
    "- [ ] In-process memory, per instance",
    "- [ ] _your answer_",
    "",
  ].join("\n")

  it("parses with zero validation errors", () => {
    expect(QA_FORMAT.validate(styledUnticked)).toEqual([])
  })

  it("each open question parses exactly three options and is unanswered before ticking", () => {
    const { questions } = parseOpenQuestions(styledUnticked)
    expect(questions).toHaveLength(2)
    for (const question of questions) {
      expect(question.options).toHaveLength(3)
      expect(question.answered).toBe(false)
    }
  })

  it("is answered once exactly one option is ticked, and leaves the other question untouched", () => {
    const ticked = styledUnticked.replace(
      "- [ ] Sliding window log, no reset boundary",
      "- [x] Sliding window log, no reset boundary",
    )
    const { questions } = parseOpenQuestions(ticked)
    expect(questions[0]!.answered).toBe(true)
    expect(questions[1]!.answered).toBe(false)
  })

  // Separate, smaller exemplar: the free-text slot is ticked but the agent's
  // placeholder text survives untouched — the placeholder normalisation must
  // still fire regardless of the voice applied around it.
  const styledFreeTextTicked = [
    "# Requirements",
    "",
    "**Ship rate limiting on the public API before the next release.** No",
    "endpoint ships without a limiter in front of it.",
    "",
    "## Open Questions",
    "",
    "### What is the limiter's time window?",
    "",
    "**A fixed window undercounts bursts at its boundary.** Pick the algorithm",
    "now, not after clients depend on the numbers.",
    "",
    "- [ ] Fixed window, reset every 60 seconds",
    "- [ ] Sliding window log, no reset boundary",
    "- [x] _your answer_",
    "",
  ].join("\n")

  it("stays unanswered when the free-text slot is ticked but left as the unfilled placeholder", () => {
    expect(QA_FORMAT.validate(styledFreeTextTicked)).toEqual([])
    const { questions } = parseOpenQuestions(styledFreeTextTicked)
    expect(questions).toHaveLength(1)
    expect(questions[0]!.options).toHaveLength(3)
    expect(questions[0]!.answered).toBe(false)
  })
})

describe("QA_FORMAT.outline fold end (last question)", () => {
  const threeQuestions = [
    "## Open Questions",
    "",
    "### Q1?",
    "",
    "a1.",
    "",
    "### Q2?",
    "",
    "a2.",
    "",
    "### Q3?",
    "",
    "a3.",
    "",
  ].join("\n")

  it("clamps the last question's range.end.line to the last line when there is no next heading", () => {
    const nodes = QA_FORMAT.outline(threeQuestions)
    expect(nodes).toHaveLength(3)
    // lines: 0..13 (14 lines total, trailing "" from the trailing "\n"), last
    // heading is at line 10, so end must fall back to lines.length - 1 = 13.
    expect(nodes[2]?.range.end.line).toBe(13)
  })

  it("clamps the last question's range.end.line to the true last line when the fixture has no trailing newline", () => {
    const noTrailingNewline = [
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "a1.",
      "",
      "### Q2?",
      "",
      "a2.",
      "",
      "### Q3?",
      "",
      "a3.",
    ].join("\n")
    const nodes = QA_FORMAT.outline(noTrailingNewline)
    expect(nodes).toHaveLength(3)
    // 13 lines total (indices 0..12), last heading at line 10, so end falls
    // back to lines.length - 1 = 12, the "a3." line itself.
    expect(nodes[2]?.range.end.line).toBe(12)
  })
})

describe("QA_FORMAT.outline children (optional field)", () => {
  it("omits `children` entirely for a question with no options", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "add and subtract.",
      "",
    ].join("\n")
    const nodes = QA_FORMAT.outline(content)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).not.toHaveProperty("children")
  })

  it("includes `children` with the exact option leaves for a question with options", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [x] GraphQL",
      "- [ ] _your answer_",
      "",
    ].join("\n")
    const nodes = QA_FORMAT.outline(content)
    expect(nodes[0]).toHaveProperty("children")
    expect(nodes[0]?.children).toHaveLength(3)
    expect(nodes[0]?.children?.map((c) => c.name)).toEqual([
      "[ ] REST",
      "[x] GraphQL",
      "[ ] your answer",
    ])
  })
})

describe("LF/CRLF line splitting", () => {
  const lfFixture = [
    "## Open Questions",
    "",
    "### Which API?",
    "",
    "- [ ] REST",
    "- [x] GraphQL",
    "",
    "### Which database?",
    "",
    "- [ ] Postgres",
    "- [ ] MySQL",
    "",
    "## Answered Questions",
    "",
    "### Already resolved?",
    "",
    "Yes.",
    "",
  ].join("\n")
  const crlfFixture = lfFixture.replaceAll("\n", "\r\n")

  it("parseOpenQuestions produces identical results for LF and CRLF line endings", () => {
    expect(parseOpenQuestions(crlfFixture)).toEqual(parseOpenQuestions(lfFixture))
  })

  it("QA_FORMAT.outline produces identical results for LF and CRLF line endings", () => {
    expect(QA_FORMAT.outline(crlfFixture)).toEqual(QA_FORMAT.outline(lfFixture))
  })
})

describe("heading regex anchors", () => {
  it("does not treat a line with leading text before '###' as a heading (requires the '^' anchor)", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "foo ### not a heading",
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    expect(questions).toHaveLength(1)
    expect(questions[0]!.text).toBe("foo ### not a heading")
  })

  it("rejects a run of more than 6 '#' as a heading (requires the '$' anchor)", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "####### not a real heading, just prose",
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    expect(questions).toHaveLength(1)
    expect(questions[0]!.text).toBe("####### not a real heading, just prose")
  })

  it("parses a heading separated from its text by two or more spaces identically to a single space", () => {
    const singleSpace = ["## Open Questions", "", "### Which API?", "", "a1.", ""].join("\n")
    const multiSpace = ["## Open Questions", "", "###   Which API?", "", "a1.", ""].join("\n")
    expect(parseOpenQuestions(multiSpace)).toEqual(parseOpenQuestions(singleSpace))
  })
})

describe("load-bearing whitespace trimming", () => {
  it("recognizes a '###' heading indented with leading whitespace", () => {
    const content = ["## Open Questions", "", "   ###   Which API?   ", "", "a1.", ""].join("\n")
    const { questions } = parseOpenQuestions(content)
    expect(questions).toHaveLength(1)
    expect(questions[0]!.question).toBe("Which API?")
  })

  it("trims extra whitespace around a checkbox option's text", () => {
    const content = ["## Open Questions", "", "### Which API?", "", "-   [ ]    REST   ", ""].join(
      "\n",
    )
    const { questions } = parseOpenQuestions(content)
    expect(questions[0]!.options[0]).toMatchObject({ text: "REST" })
  })

  it("treats a whitespace-only continuation line as blank, ending the option's span", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST, specifically",
      "   ",
      "a wrapped line after the whitespace-only line",
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    expect(questions[0]!.options[0]).toMatchObject({ sourceLine: 4, endLine: 4 })
  })

  it("treats a whitespace-only body line as blank when computing the question's summary text", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "   ",
      "   add and subtract.   ",
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    expect(questions[0]!.text).toBe("add and subtract.")
  })

  it("normalizes the free-text placeholder even with surrounding whitespace", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      `- [x]   ${FREE_TEXT_PLACEHOLDER}   `,
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    const chosen = questions[0]!.options.find((o) => o.checked)!
    expect(chosen.text).toBe("")
  })
})

describe("footnotes wired into the qa format", () => {
  const doc = [
    "## Open Questions",
    "",
    "### Which API?",
    "",
    "- [ ] REST[^fn1]",
    "- [x] GraphQL",
    "- [ ] _your answer_",
    "",
    "[^fn1]: a reason that lives below the option",
    "",
  ].join("\n")

  it("parses the anchored footnote's column, and excludes marker + definition body from the option's text", () => {
    const { questions } = parseOpenQuestions(doc)
    const option = questions[0]!.options[0]!
    expect(option.text).toBe("REST")
    expect(option.endLine).toBe(4) // the option's own line only, not the definition below it
  })

  it("still normalizes a ticked free-text option with a trailing marker to ''", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      `- [x] ${FREE_TEXT_PLACEHOLDER}[^fn1]`,
      "",
      "[^fn1]: explanation",
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    const chosen = questions[0]!.options.find((o) => o.checked)!
    expect(chosen.text).toBe("")
    expect(questions[0]!.answered).toBe(false)
  })

  it("surfaces all four footnote findings, each with its line", () => {
    const content = [
      "## Open Questions",
      "",
      "### Q1",
      "",
      "orphan marker[^missing]",
      "",
      "[^unreferenced]: nobody points here",
      "[^dup]: first",
      "[^dup]: second",
      "[^placeholder]: your comment",
      "",
    ].join("\n")
    // give dup and placeholder markers so only the intended findings fire per name
    const findings = QA_FORMAT.validate(content)
    const messages = findings.map((f) => f.message)
    expect(messages.some((m) => m.includes('"[^missing]" has no matching definition'))).toBe(true)
    expect(messages.some((m) => m.includes('"[^unreferenced]" has no marker referencing it'))).toBe(
      true,
    )
    expect(messages.some((m) => m.includes('Duplicate footnote definition "[^dup]"'))).toBe(true)
    expect(
      messages.some((m) => m.includes('"[^placeholder]" still has its seeded placeholder body')),
    ).toBe(true)
    expect(findings.every((f) => f.line !== undefined)).toBe(true)
  })

  it("outline places a footnote leaf under the option whose span holds its marker", () => {
    const nodes = QA_FORMAT.outline(doc)
    const optionNode = nodes[0]!.children!.find((c) => c.name.startsWith("[ ] REST"))!
    expect(optionNode.children).toHaveLength(1)
    expect(optionNode.children![0]!.name).toBe("[^fn1] a reason that lives below the option")
    expect(optionNode.children![0]!.leaf).toBe(true)
  })

  it("outline places a footnote leaf under the question when its marker is in question-body prose", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "question-level note[^fn1]",
      "",
      "- [ ] REST",
      "- [x] _your answer_",
      "",
      "[^fn1]: a reason",
      "",
    ].join("\n")
    const nodes = QA_FORMAT.outline(content)
    const questionFootnote = nodes[0]!.children!.find((c) => c.name.startsWith("[^fn1]"))!
    expect(questionFootnote.leaf).toBe(true)
  })

  it("QA_FORMAT.validate(QA_FORMAT.sample) returns zero findings", () => {
    expect(QA_FORMAT.validate(QA_FORMAT.sample)).toEqual([])
  })

  it("strips a marker from the question heading text", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API[^fn1]?",
      "",
      "- [ ] REST",
      "- [ ] _your answer_",
      "",
      "[^fn1]: reason",
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    expect(questions[0]!.question).toBe("Which API?")
  })

  it("does not set leaf: true on an option node that carries footnote children", () => {
    const nodes = QA_FORMAT.outline(doc)
    const optionNode = nodes[0]!.children!.find((c) => c.name.startsWith("[ ] REST"))!
    expect(optionNode.children).toHaveLength(1)
    expect(optionNode.leaf).toBeUndefined()
  })

  it("still sets leaf: true on an option node with no footnote children", () => {
    const nodes = QA_FORMAT.outline(doc)
    const optionNode = nodes[0]!.children!.find((c) => c.name.startsWith("[x] GraphQL"))!
    expect(optionNode.children).toBeUndefined()
    expect(optionNode.leaf).toBe(true)
  })
})

describe("'gtd: add a footnote' action", () => {
  const at = (line: number, character = 0) => ({
    start: { line, character },
    end: { line, character },
  })
  const footnoteAction = (content: string, line: number, character = 0) =>
    QA_FORMAT.actions(content, at(line, character)).find((a) => a.title === "gtd: add a footnote")

  it("inside a question's option list, lands after the last line of the contiguous list — not between two items", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [ ] GraphQL",
      "- [ ] _your answer_",
      "",
    ].join("\n")
    const action = footnoteAction(content, 4, 3)! // cursor on the REST line
    expect(action.edits[1]!.range.start.line).toBe(7) // after "_your answer_", not after REST
  })

  it("in ordinary prose (question-body text before any options), lands after the current block's last line", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "some prose",
      "continues here",
      "",
      "- [ ] REST",
      "- [ ] _your answer_",
      "",
    ].join("\n")
    const action = footnoteAction(content, 4, 2)! // cursor inside "some prose"
    expect(action.edits[1]!.range.start.line).toBe(6) // "continues here", not the options list
  })

  it("is offered everywhere, always titled 'gtd: add a footnote', carrying exactly two edits", () => {
    const action = footnoteAction(QA_FORMAT.sample, 0, 0)
    expect(action).toBeDefined()
    expect(action!.edits).toHaveLength(2)
  })

  it("never shares a start position between its two edits, even with the cursor at the very end of the block's last line (regression)", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [ ] _your answer_",
      "",
    ].join("\n")
    const action = footnoteAction(content, 5, "- [ ] _your answer_".length)!
    const [markerEdit, definitionEdit] = action.edits
    expect(definitionEdit!.range.start.line).toBeGreaterThan(markerEdit!.range.start.line)
  })

  it("is refused with the cursor inside an existing marker's [^name] span — planting a new marker there would nest it", () => {
    const content = ["- [ ] Option A[^fn1]", "", "[^fn1]: reason", ""].join("\n")
    const character = content.split("\n")[0]!.indexOf("[^fn1]") + 2 // inside the name
    expect(footnoteAction(content, 0, character)).toBeUndefined()
  })

  it("is refused with the cursor on an existing definition's own label line — planting a definition there would split it", () => {
    const content = ["- [ ] Option A[^fn1]", "", "[^fn1]: reason", ""].join("\n")
    expect(footnoteAction(content, 2, 3)).toBeUndefined()
  })
})

describe("sections and questions come from heading NODES, not string search", () => {
  it("a '## Open Questions' line quoted inside a fenced code block does not count as the section", () => {
    const content = [
      "Build a thing. This file documents its own format.",
      "",
      "```",
      "## Open Questions",
      "```",
      "",
      "## Open Questions",
      "",
      "### Real question?",
      "",
      "an answer.",
      "",
    ].join("\n")
    const result = parseOpenQuestions(content)
    expect(result.errors).toEqual([])
    expect(result.questions).toEqual([
      {
        question: "Real question?",
        status: "open",
        text: "an answer.",
        headingLine: 8,
        options: [],
        answered: false,
      },
    ])
  })

  it("a '## Open Questions' heading preceded by a fenced block that merely LOOKS like a competing section still validates clean", () => {
    const content = [
      "```",
      "## Implementation Notes",
      "```",
      "",
      "## Open Questions",
      "",
      "### Real question?",
      "",
      "an answer.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content).errors).toEqual([])
  })
})

describe("strict indentation reading", () => {
  it("a '###' heading indented two spaces still counts as a question", () => {
    const content = ["## Open Questions", "", "  ### two spaces", "", "a1.", ""].join("\n")
    const { questions } = parseOpenQuestions(content)
    expect(questions).toHaveLength(1)
    expect(questions[0]!.question).toBe("two spaces")
  })

  it("a '###' heading indented four spaces is indented code, not a question heading — reported as a positioned refusal, not silently dropped", () => {
    const content = ["## Open Questions", "", "    ### four spaces", "", "a1.", ""].join("\n")
    const { questions, errors } = parseOpenQuestions(content)
    expect(questions).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("### four spaces")
    expect(QA_FORMAT.validate(content)).toEqual([{ message: errors[0], line: 2 }])
  })

  it("a '- [ ]' option indented two or three spaces still counts as an option", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "  - [ ] REST",
      "   - [ ] GraphQL",
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    expect(questions[0]!.options.map((o) => o.text)).toEqual(["REST", "GraphQL"])
  })

  it("a '- [ ]' option indented four spaces is indented code, not an option — reported as a positioned refusal, not silently dropped", () => {
    const content = ["## Open Questions", "", "### Which API?", "", "    - [ ] REST", ""].join("\n")
    const { questions, errors } = parseOpenQuestions(content)
    expect(questions[0]!.options).toEqual([])
    expect(questions[0]!.answered).toBe(false)
    expect(unansweredQuestions(content).map((q) => q.question)).toEqual(["Which API?"])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("- [ ] REST")
    expect(QA_FORMAT.validate(content)).toEqual([{ message: errors[0], line: 4 }])
  })
})

describe("a footnoteDefinition directly below the last option, no blank line between", () => {
  it("is not part of the last option's span", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] REST",
      "- [ ] _your answer_",
      "[^fn1]: a reason directly below, no blank line",
      "",
    ].join("\n")
    const { questions } = parseOpenQuestions(content)
    const [, last] = questions[0]!.options
    expect(last).toMatchObject({ sourceLine: 5, endLine: 5 })
  })
})

describe("toggleCheckbox's exact box offset", () => {
  it("toggles the box, not a '[' that appears in the option's own text", () => {
    const doc = [
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [ ] [priority] Ship it",
      "",
    ].join("\n")
    const edit = toggleCheckbox(doc, 4)!
    const lines = doc.split("\n")
    const line = lines[4]!
    expect(line[edit.range.start.character]).toBe(" ")
    const applied =
      line.slice(0, edit.range.start.character) +
      edit.newText +
      line.slice(edit.range.end.character)
    expect(applied).toBe("- [x] [priority] Ship it")
  })

  it("flips exactly one character, leaving every other byte of the line untouched", () => {
    const doc = ["## Open Questions", "", "### Which API?", "", "- [ ] REST option", ""].join("\n")
    const edit = toggleCheckbox(doc, 4)!
    expect(edit.range.end.character - edit.range.start.character).toBe(1)
    const lines = doc.split("\n")
    const line = lines[4]!
    const applied =
      line.slice(0, edit.range.start.character) +
      edit.newText +
      line.slice(edit.range.end.character)
    expect(applied).toBe("- [x] REST option")
  })
})
