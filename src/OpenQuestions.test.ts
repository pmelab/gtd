import { describe, expect, it } from "vitest"
import { parseOpenQuestions } from "./OpenQuestions.js"

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

  it("parses a single open question with a free-form body", () => {
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
        },
      ],
      errors: [],
    })
  })

  it("marks questions under ## Answered Questions as answered", () => {
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
        },
      ],
      errors: [],
    })
  })

  it("no longer requires a Suggested default:/Answer: marker line", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "Not sure yet — leaning towards add and subtract.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content)).toEqual({
      questions: [
        {
          question: "Which operations?",
          status: "open",
          text: "Not sure yet — leaning towards add and subtract.",
          headingLine: 2,
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
        },
      ],
      errors: [],
    })
  })

  it("parses both sections and returns questions in document order", () => {
    const content = [
      "## Open Questions",
      "",
      "### Still deciding the platform?",
      "",
      "web only, for now.",
      "",
      "## Answered Questions",
      "",
      "### Which operations?",
      "",
      "add, subtract, and multiply.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content).questions).toEqual([
      {
        question: "Still deciding the platform?",
        status: "open",
        text: "web only, for now.",
        headingLine: 2,
      },
      {
        question: "Which operations?",
        status: "answered",
        text: "add, subtract, and multiply.",
        headingLine: 8,
      },
    ])
  })

  it("sorts by document order even when Answered appears above Open", () => {
    const content = [
      "## Answered Questions",
      "",
      "### Already settled?",
      "",
      "yes.",
      "",
      "## Open Questions",
      "",
      "### Still open?",
      "",
      "maybe.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content).questions).toEqual([
      { question: "Already settled?", status: "answered", text: "yes.", headingLine: 2 },
      { question: "Still open?", status: "open", text: "maybe.", headingLine: 8 },
    ])
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
      { question: "Real question?", status: "open", text: "an answer.", headingLine: 4 },
    ])
    expect(result.errors).toHaveLength(1)
  })
})
