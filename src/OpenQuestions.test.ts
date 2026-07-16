import { describe, expect, it } from "vitest"
import { parseOpenQuestions } from "./OpenQuestions.js"

describe("parseOpenQuestions", () => {
  it("returns zero questions and zero errors when there is no Open Questions section", () => {
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

  it("parses a single well-formed suggested-default question", () => {
    const content = [
      "# Plan",
      "",
      "Build a calculator.",
      "",
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "Suggested default: add and subtract.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content)).toEqual({
      questions: [
        { question: "Which operations?", status: "suggested", text: "add and subtract." },
      ],
      errors: [],
    })
  })

  it("parses an answered question", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "Answer: add, subtract, and multiply.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content)).toEqual({
      questions: [
        { question: "Which operations?", status: "answered", text: "add, subtract, and multiply." },
      ],
      errors: [],
    })
  })

  it("parses multiple questions in one section", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "Suggested default: add and subtract.",
      "",
      "### What is the target platform?",
      "",
      "Answer: web only.",
      "",
    ].join("\n")
    expect(parseOpenQuestions(content).questions).toEqual([
      { question: "Which operations?", status: "suggested", text: "add and subtract." },
      { question: "What is the target platform?", status: "answered", text: "web only." },
    ])
  })

  it("stops the Open Questions section at the next H2 heading", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "Suggested default: add and subtract.",
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
        { question: "Which operations?", status: "suggested", text: "add and subtract." },
      ],
      errors: [],
    })
  })

  it("errors when a question has no Suggested default:/Answer: line", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "Not sure yet.",
      "",
    ].join("\n")
    const result = parseOpenQuestions(content)
    expect(result.questions).toEqual([])
    expect(result.errors).toEqual([
      'Open question "Which operations?" is missing a "Suggested default: ..." or "Answer: ..." line',
    ])
  })

  it("errors when a question has an empty response line", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "Suggested default:",
      "",
    ].join("\n")
    const result = parseOpenQuestions(content)
    expect(result.questions).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it("errors when a question has no body at all before the next heading", () => {
    const content = [
      "## Open Questions",
      "",
      "### Which operations?",
      "### What is the target platform?",
      "",
      "Answer: web only.",
      "",
    ].join("\n")
    const result = parseOpenQuestions(content)
    expect(result.errors).toEqual([
      'Open question "Which operations?" is missing a "Suggested default: ..." or "Answer: ..." line',
    ])
    expect(result.questions).toEqual([
      { question: "What is the target platform?", status: "answered", text: "web only." },
    ])
  })

  it("collects one error per malformed question and keeps well-formed ones", () => {
    const content = [
      "## Open Questions",
      "",
      "### First?",
      "",
      "no marker here",
      "",
      "### Second?",
      "",
      "Suggested default: yes.",
      "",
      "### Third?",
      "",
      "also no marker",
      "",
    ].join("\n")
    const result = parseOpenQuestions(content)
    expect(result.questions).toEqual([{ question: "Second?", status: "suggested", text: "yes." }])
    expect(result.errors).toHaveLength(2)
  })
})
