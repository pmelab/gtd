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
    expect(actions).toHaveLength(1)
    expect(actions[0]?.title).toBe("gtd: pick this option")
    const edits = actions[0]?.edits ?? []
    expect(edits.map((e) => e.range.start.line).sort()).toEqual([4, 5])
    expect(edits.find((e) => e.range.start.line === 4)?.newText).toBe("x")
    expect(edits.find((e) => e.range.start.line === 5)?.newText).toBe(" ")
  })

  it("actions offer 'uncheck this option' on the already-ticked option, and nothing off an option line", () => {
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
    expect(actions[0]?.title).toBe("gtd: uncheck this option")
    expect(actions[0]?.edits).toHaveLength(1)
    expect(QA_FORMAT.actions(doc, at(2))).toEqual([]) // the ### heading
  })

  it("has no pointerAt", () => {
    expect(QA_FORMAT.pointerAt).toBeUndefined()
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
