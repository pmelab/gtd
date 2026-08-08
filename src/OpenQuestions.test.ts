import { describe, expect, it } from "vitest"
import { FREE_TEXT_PLACEHOLDER, parseOpenQuestions, unansweredQuestions } from "./OpenQuestions.js"

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
  const doc = (options: readonly string[]): string =>
    ["Build a thing.", "", "## Open Questions", "", "### Which API?", "", ...options, ""].join("\n")

  it("returns nothing when there are no open questions", () => {
    expect(unansweredQuestions(parseOpenQuestions("Build a thing. Plan: do it.\n"))).toEqual([])
  })

  it("returns the open question when no option is ticked", () => {
    const result = unansweredQuestions(
      parseOpenQuestions(doc(["- [ ] REST", "- [ ] GraphQL", "- [ ] _your answer_"])),
    )
    expect(result.map((q) => q.question)).toEqual(["Which API?"])
  })

  it("returns nothing when every open question is answered", () => {
    const result = unansweredQuestions(
      parseOpenQuestions(doc(["- [ ] REST", "- [x] GraphQL", "- [ ] _your answer_"])),
    )
    expect(result).toEqual([])
  })

  it("excludes answered-status questions", () => {
    const content = "## Answered Questions\n\n### Which API?\n\nUse tRPC.\n"
    expect(unansweredQuestions(parseOpenQuestions(content))).toEqual([])
  })
})
