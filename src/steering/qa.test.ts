import { describe, expect, it } from "vitest"
import {
  checkSteering,
  clearTicks,
  steeringFormatFor,
  unansweredQuestions,
  viewOf,
} from "./index.js"
import {
  FREE_TEXT_PLACEHOLDER,
  isAnswered,
  openQuestionOptions,
  openQuestionTexts,
  parseOpenQuestions,
} from "./qa.js"
import { getParseCount } from "./index.js"

const qa = steeringFormatFor("qa")!

const doc = (lines: readonly string[]): string => lines.join("\n")

describe("qa — structure (checkSteering)", () => {
  it("an empty document has no questions and no findings", () => {
    expect(checkSteering(qa, "")).toEqual([])
    expect(unansweredQuestions(qa, "")).toEqual([])
  })

  it("an Open Questions section present but empty is valid", () => {
    expect(checkSteering(qa, doc(["# Plan", "", "## Open Questions", ""]))).toEqual([])
  })

  it("a question with a free-form body (no options) validates clean", () => {
    const content = doc([
      "# Plan",
      "",
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "add and subtract.",
      "",
    ])
    expect(checkSteering(qa, content)).toEqual([])
    expect(unansweredQuestions(qa, content)).toEqual([
      expect.objectContaining({ question: "Which operations?" }),
    ])
  })

  it("stops a questions section at the next H2 heading — a later '### ' under a different section is not a question", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Which operations?",
      "",
      "- [ ] A",
      "- [ ] B",
      "",
      "## Implementation Notes",
      "",
      "### Not a question",
      "",
      "This should be ignored entirely.",
      "",
    ])
    expect(unansweredQuestions(qa, content)).toHaveLength(1)
  })

  it("keeps a well-formed question while also collecting a bare-heading finding elsewhere in the same doc", () => {
    const content = doc([
      "## Open Questions",
      "",
      "###",
      "",
      "### Real question?",
      "",
      "- [ ] A",
      "- [ ] B",
      "",
    ])
    const findings = checkSteering(qa, content)
    expect(findings).toHaveLength(1)
    expect(unansweredQuestions(qa, content)).toEqual([
      expect.objectContaining({ question: "Real question?" }),
    ])
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

    it("normalizes the placeholder case-insensitively, regardless of the constant's OWN casing — never assumes FREE_TEXT_PLACEHOLDER itself is already lowercase", () => {
      const result = parseOpenQuestions(
        q(["", "- [ ] REST", "- [ ] GraphQL", `- [x] ${FREE_TEXT_PLACEHOLDER.toUpperCase()}`]),
      )
      const question = result.questions[0]!
      expect(question.answered).toBe(false)
      expect(question.options[2]!.text).toBe("")
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
      expect(parseOpenQuestions(content).findings.map((f) => f.message)).toEqual([
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
      expect(parseOpenQuestions(content).findings.map((f) => f.message)).toEqual([
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
      expect(parseOpenQuestions(content).findings.map((f) => f.message)).toEqual([
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
      expect(parseOpenQuestions(content).findings.map((f) => f.message)).toEqual([
        "A '##' section appears before '## Open Questions', which must come first",
        "A '##' section appears after '## Answered Questions', which must come last",
      ])
    })

    it("reports no ordering finding with only '## Open Questions' present", () => {
      const content = ["## Open Questions", "", "### Which operations?", "", "add.", ""].join("\n")
      expect(parseOpenQuestions(content).findings.map((f) => f.message)).toEqual([])
    })

    it("reports no ordering finding with only '## Answered Questions' present", () => {
      const content = ["## Answered Questions", "", "### Already resolved?", "", "Yes.", ""].join(
        "\n",
      )
      expect(parseOpenQuestions(content).findings.map((f) => f.message)).toEqual([])
    })

    it("reports no ordering finding when neither section is present", () => {
      const content = ["## Implementation Notes", "", "some notes.", ""].join("\n")
      expect(parseOpenQuestions(content).findings.map((f) => f.message)).toEqual([])
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
      expect(parseOpenQuestions(content).findings.map((f) => f.message)).toEqual([])
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

    it("a bare marker with no text on its OWN line, whose text starts on the next (indented) line, has text '' — not the marker itself", () => {
      const result = parseOpenQuestions(q(["", "- [ ]", "  text here", "- [ ] _your answer_"]))
      const [option] = result.questions[0]!.options
      expect(option).toMatchObject({ text: "", sourceLine: 4, endLine: 5 })
    })

    it("a ticked free-text option answered ONLY on its continuation line still reads text '' and stays UNANSWERED — the answer must be on the marker's own line", () => {
      const result = parseOpenQuestions(q(["", "- [ ] REST", "- [x]", "  my own answer"]))
      const question = result.questions[0]!
      const chosen = question.options.find((o) => o.checked)!
      expect(chosen).toMatchObject({ text: "", freeText: true })
      expect(question.answered).toBe(false)
    })
  })

  it("a '####' heading inside the section is not treated as a question block at all", () => {
    const content = doc([
      "## Open Questions",
      "",
      "#### Not a question depth",
      "",
      "### Real question?",
      "",
      "- [ ] A",
      "- [ ] B",
      "",
    ])
    expect(unansweredQuestions(qa, content)).toEqual([
      expect.objectContaining({ question: "Real question?" }),
    ])
  })
})

describe("qa — answer completeness (unansweredQuestions)", () => {
  const q = (lines: readonly string[]): string =>
    doc(["## Open Questions", "", "### Which API?", ...lines, ""])

  it("two options, none ticked, is unanswered", () => {
    const content = q(["", "- [ ] REST", "- [ ] GraphQL", "- [ ] _your answer_"])
    expect(unansweredQuestions(qa, content)).toHaveLength(1)
  })

  it("exactly one ticked option is answered", () => {
    const content = q(["", "- [ ] REST", "- [x] GraphQL", "- [ ] _your answer_"])
    expect(unansweredQuestions(qa, content)).toEqual([])
  })

  it("two ticked options (ambiguous) is unanswered", () => {
    const content = q(["", "- [x] REST", "- [x] GraphQL", "- [ ] _your answer_"])
    expect(unansweredQuestions(qa, content)).toHaveLength(1)
  })

  it("the free-text slot ticked WITH real text is answered", () => {
    const content = q(["", "- [ ] REST", "- [ ] GraphQL", "- [x] use tRPC"])
    expect(unansweredQuestions(qa, content)).toEqual([])
  })

  it("the free-text slot ticked but left as the unfilled placeholder is unanswered", () => {
    const content = q(["", "- [ ] REST", "- [ ] GraphQL", "- [x] _your answer_"])
    expect(unansweredQuestions(qa, content)).toHaveLength(1)
  })

  it("accepts '* [X]' bullet/upper-case tick syntax", () => {
    const content = q(["", "* [ ] REST", "* [X] GraphQL"])
    expect(unansweredQuestions(qa, content)).toEqual([])
  })

  it("only the LAST option is ever the free-text slot — a non-last option literally equal to the placeholder is not normalized", () => {
    const content = q(["", "- [ ] _your answer_", "- [x] real free text"])
    expect(unansweredQuestions(qa, content)).toEqual([])
  })

  it("an answered-section question carries no options even with checkbox-looking lines, and is never 'unanswered'", () => {
    const content = doc(["## Answered Questions", "", "### Which API?", "", "Use tRPC.", ""])
    expect(unansweredQuestions(qa, content)).toEqual([])
  })

  it("a bare marker with no text on its own line, text on an indented continuation, stays unanswered when unticked", () => {
    const content = q(["", "- [ ]", "  text here", "- [ ] _your answer_"])
    expect(unansweredQuestions(qa, content)).toHaveLength(1)
  })

  it("a ticked free-text option answered ONLY on its continuation line still reads unanswered — the answer must be on the marker's own line", () => {
    const content = q(["", "- [ ] REST", "- [x]", "  my own answer"])
    expect(unansweredQuestions(qa, content)).toHaveLength(1)
  })

  it("returns [] once every open question is answered", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### A?",
      "",
      "- [x] Yes",
      "- [ ] No",
      "",
      "### B?",
      "",
      "- [ ] Yes",
      "- [x] No",
      "",
    ])
    expect(unansweredQuestions(qa, content)).toEqual([])
  })

  it("lists every unanswered open question with its heading line", () => {
    const content = doc([
      "Plan.",
      "",
      "## Open Questions",
      "",
      "### Which backend?",
      "",
      "- [ ] SQLite",
      "- [ ] Postgres",
      "",
    ])
    expect(unansweredQuestions(qa, content)).toEqual([
      expect.objectContaining({ question: "Which backend?", headingLine: 4 }),
    ])
  })
})

describe("openQuestionTexts", () => {
  it("returns each open question's heading text, in document order", () => {
    const content = doc([
      "Plan.",
      "",
      "## Open Questions",
      "",
      "### Which backend?",
      "",
      "- [ ] SQLite",
      "- [ ] Postgres",
      "",
      "### Which cache?",
      "",
      "- [ ] Redis",
      "- [ ] Memcached",
      "",
    ])
    expect(openQuestionTexts(content)).toEqual(["Which backend?", "Which cache?"])
  })

  it("omits an already-answered question", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### A?",
      "",
      "- [x] Yes",
      "- [ ] No",
      "",
      "### B?",
      "",
      "- [ ] Yes",
      "- [ ] No",
      "",
    ])
    expect(openQuestionTexts(content)).toEqual(["B?"])
  })

  it("returns [] for a file with no questions at all", () => {
    expect(openQuestionTexts("Just a plan, no questions.")).toEqual([])
  })

  it("returns [] for a missing file (undefined content)", () => {
    expect(openQuestionTexts(undefined)).toEqual([])
  })
})

describe("openQuestionOptions", () => {
  it("returns each open question's text plus its real (listed) option texts, excluding the free-text slot", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Which backend?",
      "",
      "- [ ] SQLite",
      "- [ ] Postgres",
      "- [ ] _your answer_",
      "",
    ])
    expect(openQuestionOptions(content)).toEqual([
      { question: "Which backend?", options: ["SQLite", "Postgres"] },
    ])
  })

  it("omits an already-answered question", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### A?",
      "",
      "- [x] Yes",
      "- [ ] No",
      "- [ ] _your answer_",
      "",
      "### B?",
      "",
      "- [ ] Yes",
      "- [ ] No",
      "- [ ] _your answer_",
      "",
    ])
    expect(openQuestionOptions(content)).toEqual([{ question: "B?", options: ["Yes", "No"] }])
  })

  it("returns [] for a file with no questions at all", () => {
    expect(openQuestionOptions("Just a plan, no questions.")).toEqual([])
  })

  it("returns [] for a missing file (undefined content)", () => {
    expect(openQuestionOptions(undefined)).toEqual([])
  })
})

describe("qa — section ordering", () => {
  it("reports at most one 'before' finding even with multiple sections preceding Open Questions", () => {
    const content = doc([
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
    ])
    expect(checkSteering(qa, content).map((f) => f.message)).toEqual([
      "A '##' section appears before '## Open Questions', which must come first",
    ])
  })

  it("reports both findings when '## Answered Questions' comes before '## Open Questions'", () => {
    const content = doc([
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
    ])
    expect(checkSteering(qa, content).map((f) => f.message)).toEqual([
      "A '##' section appears before '## Open Questions', which must come first",
      "A '##' section appears after '## Answered Questions', which must come last",
    ])
  })

  it("reports no ordering finding with only '## Answered Questions' present", () => {
    const content = doc(["## Answered Questions", "", "### Already resolved?", "", "Yes.", ""])
    expect(checkSteering(qa, content)).toEqual([])
  })

  it("reports no ordering finding when neither section is present", () => {
    expect(checkSteering(qa, doc(["## Implementation Notes", "", "some notes.", ""]))).toEqual([])
  })

  it("reports no finding for lead prose and a level-1 title above '## Open Questions'", () => {
    const content = doc([
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
    ])
    expect(checkSteering(qa, content)).toEqual([])
  })
})

describe("qa — outline (option span, endLine, footnotes, ordering)", () => {
  it("marks a prose (option-less) open question as unanswered, and answered-section questions as answered", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Free-form?",
      "",
      "some prose.",
      "",
      "## Answered Questions",
      "",
      "### Resolved?",
      "",
      "yes.",
      "",
    ])
    const outline = viewOf(qa, content).outline
    expect(outline[0]!.name).toContain("[unanswered]")
    expect(outline[1]!.name).toContain("[answered]")
  })

  it("marks an open question with exactly one ticked option as answered, listing options as children", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Which API?",
      "",
      "- [x] REST",
      "- [ ] GraphQL",
      "",
    ])
    const outline = viewOf(qa, content).outline
    expect(outline[0]!.name).toContain("[answered]")
    expect(outline[0]!.children).toHaveLength(2)
  })

  it("returns no nodes when there is no Open Questions section", () => {
    expect(viewOf(qa, "# Plan\n\nBuild a thing.\n").outline).toEqual([])
  })

  it("omits 'children' entirely for a question with no options", () => {
    const content = doc(["## Open Questions", "", "### Free-form?", "", "prose.", ""])
    expect(viewOf(qa, content).outline[0]).not.toHaveProperty("children")
  })

  it("ends the last question's range at its own last block, not the trailing blank run", () => {
    const content = doc(["## Open Questions", "", "### Q1?", "", "- [ ] A", "- [ ] B", "", "", ""])
    const node = viewOf(qa, content).outline[0]!
    expect(node.range.end.line).toBe(5)
  })

  it("ends an interior question's range at its own last block too, not at the next heading minus one", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "- [ ] A",
      "- [ ] B",
      "",
      "",
      "### Q2?",
      "",
      "- [ ] C",
      "- [ ] D",
      "",
    ])
    const node = viewOf(qa, content).outline[0]!
    expect(node.range.end.line).toBe(5)
  })

  it("clamps the last question's range.end.line to the true last line when the fixture has no trailing newline", () => {
    const content = "## Open Questions\n\n### Q1?\n\n- [ ] A"
    const node = viewOf(qa, content).outline[0]!
    expect(node.range.end.line).toBe(4)
  })

  it("places a footnote leaf under the option whose span holds its marker", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "- [ ] A[^fn1]",
      "- [ ] B",
      "",
      "[^fn1]:",
      "    Detail about option A that is longer than eighty characters for wrapping.",
      "",
    ])
    const option = viewOf(qa, content).outline[0]!.children![0]!
    expect(option.children).toHaveLength(1)
  })

  it("places a footnote leaf under the question when its marker is in question-body prose", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "prose with a marker[^fn1].",
      "",
      "- [ ] A",
      "- [ ] B",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it wraps across lines nicely.",
      "",
    ])
    const question = viewOf(qa, content).outline[0]!
    expect(question.children!.some((c) => c.name.includes("fn1") === false)).toBe(true)
    // the option children (leaf, no footnote) plus one footnote child on the question itself
    expect(question.children).toHaveLength(3)
  })

  it("does not set leaf:true on an option node that carries footnote children", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "- [ ] A[^fn1]",
      "- [ ] B",
      "",
      "[^fn1]:",
      "    Detail about option A that is longer than eighty characters for wrapping.",
      "",
    ])
    const option = viewOf(qa, content).outline[0]!.children![0]!
    expect(option).not.toHaveProperty("leaf")
  })

  it("still sets leaf:true on an option node with no footnote children", () => {
    const content = doc(["## Open Questions", "", "### Q1?", "", "- [ ] A", "- [ ] B", ""])
    const option = viewOf(qa, content).outline[0]!.children![0]!
    expect(option).toMatchObject({ leaf: true })
  })

  it("a '- [ ]'-shaped line quoted inside a footnote definition's own body is not a dropped option", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "- [ ] A[^fn1]",
      "",
      "[^fn1]:",
      "    Example: `- [ ] not a real option, just quoted inside a footnote body here`.",
      "",
    ])
    expect(checkSteering(qa, content)).toEqual([])
  })
})

describe("qa — sections and questions come from heading NODES, not string search", () => {
  it("a '## Open Questions' line quoted inside a fenced code block does not count as the section", () => {
    const content = doc(["Some prose.", "", "```", "## Open Questions", "", "### fake?", "```", ""])
    expect(checkSteering(qa, content)).toEqual([])
    expect(unansweredQuestions(qa, content)).toEqual([])
  })

  it("a fenced block using '~~~' delimiters is recognized the same way", () => {
    const content = doc(["Some prose.", "", "~~~", "## Open Questions", "~~~", ""])
    expect(checkSteering(qa, content)).toEqual([])
  })
})

describe("qa — strict indentation reading", () => {
  it("a '###' heading indented two spaces still counts as a question", () => {
    const content = doc(["## Open Questions", "", "  ### Real question?", "", "- [ ] A", ""])
    expect(checkSteering(qa, content)).toEqual([])
  })

  it("a '###' heading indented four spaces is reported as a positioned refusal, not silently dropped", () => {
    const content = doc(["## Open Questions", "", "    ### Dropped question?", "", "text", ""])
    const findings = checkSteering(qa, content)
    expect(findings.some((f) => f.message.includes("not a question heading"))).toBe(true)
  })

  it("a '- [ ]' option indented four spaces is reported as a positioned refusal", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Real question?",
      "",
      "    - [ ] Dropped option",
      "",
    ])
    const findings = checkSteering(qa, content)
    expect(findings.some((f) => f.message.includes("not an option"))).toBe(true)
  })

  it("a 4+-space NESTED option under a real option is still reported, not silently absorbed", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Real question?",
      "",
      "- [ ] Parent option",
      "    - [ ] Nested option",
      "",
    ])
    const findings = checkSteering(qa, content)
    expect(findings.some((f) => f.message.includes("not an option"))).toBe(true)
  })

  it("a genuinely shallow (under 4 spaces) nested option is untouched — no finding", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Real question?",
      "",
      "- [ ] Parent option",
      "  - [ ] Shallow nested option",
      "",
    ])
    expect(checkSteering(qa, content)).toEqual([])
  })

  it("a 4+-space heading folded into a preceding option's own lazy continuation is still reported, and the question it would start stays missing", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### A?",
      "",
      "- [ ] one",
      "    ### B?",
      "",
      "- [ ] two",
    ])
    const findings = checkSteering(qa, content)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.message).toContain("### B?")
    expect(unansweredQuestions(qa, content)).toEqual([expect.objectContaining({ question: "A?" })])
  })
})

describe("qa — strict-reading ignores indented lines that aren't heading- or option-shaped", () => {
  it("a plain indented (4+ space) prose line inside the section is not reported at all", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Real question?",
      "",
      "some prose.",
      "    just an indented continuation, not heading- or option-shaped",
      "",
    ])
    expect(checkSteering(qa, content)).toEqual([])
  })
})

describe("qa — actions (options, footnotes)", () => {
  it("offers 'pick this option' on an unticked option, and unticks the previously-ticked sibling", () => {
    const content = doc(["## Open Questions", "", "### Q1?", "", "- [x] A", "- [ ] B", ""])
    const actions = qa.actions(content, {
      start: { line: 5, character: 2 },
      end: { line: 5, character: 2 },
    })
    const pick = actions.find((a) => a.title === "gtd: pick this option")!
    expect(pick.edits).toHaveLength(2)
  })

  it("offers 'uncheck this option' on the already-ticked option", () => {
    const content = doc(["## Open Questions", "", "### Q1?", "", "- [x] A", "- [ ] B", ""])
    const actions = qa.actions(content, {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 2 },
    })
    expect(actions.some((a) => a.title === "gtd: uncheck this option")).toBe(true)
  })

  it("has a footnote-only pointerAt", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "- [ ] A[^fn1]",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here.",
      "",
    ])
    const pointer = qa.pointerAt!(content, { line: 4, character: 8 })
    expect(pointer).toBeDefined()
  })

  it("'add a footnote' lands after the last line of a contiguous option list, not between items", () => {
    const content = doc(["## Open Questions", "", "### Q1?", "", "- [ ] A", "- [ ] B", ""])
    const actions = qa.actions(content, {
      start: { line: 4, character: 5 },
      end: { line: 4, character: 5 },
    })
    const footnote = actions.find((a) => a.title === "gtd: add a footnote")!
    expect(footnote).toBeDefined()
  })

  it("in a question with no options at all, 'add a footnote' still lands after that question's own block", () => {
    const content = doc(["## Open Questions", "", "### Q1?", "", "just prose.", ""])
    const actions = qa.actions(content, {
      start: { line: 4, character: 3 },
      end: { line: 4, character: 3 },
    })
    expect(actions.some((a) => a.title === "gtd: add a footnote")).toBe(true)
  })

  it("outside every question (lead prose above '## Open Questions'), still offers 'add a footnote'", () => {
    const content = doc([
      "Some lead prose.",
      "",
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "text",
      "",
    ])
    const actions = qa.actions(content, {
      start: { line: 0, character: 3 },
      end: { line: 0, character: 3 },
    })
    expect(actions.some((a) => a.title === "gtd: add a footnote")).toBe(true)
  })

  it("is refused with the cursor inside an existing marker's span", () => {
    const content = doc([
      "## Open Questions",
      "",
      "### Q1?",
      "",
      "- [ ] A[^fn1]",
      "",
      "[^fn1]:",
      "    Detail that is longer than eighty characters so it definitely wraps here.",
      "",
    ])
    const actions = qa.actions(content, {
      start: { line: 4, character: 8 },
      end: { line: 4, character: 8 },
    })
    expect(actions.some((a) => a.title === "gtd: add a footnote")).toBe(false)
  })
})

describe("qa — clearTicks is a deliberate no-op", () => {
  it("never clears its own answer tick — qa's ticks ARE its answers", () => {
    const content = doc(["## Open Questions", "", "### Q1?", "", "- [x] A", "- [ ] B", ""])
    expect(clearTicks(qa, content)).toBe(content)
  })
})

describe("isAnswered — the ONE predicate exported for a client to reuse, never re-derive (T5)", () => {
  it("is answered when exactly one option is ticked and it isn't the free-text slot", () => {
    expect(
      isAnswered([
        { checked: true, text: "Option A", freeText: false },
        { checked: false, text: "Option B", freeText: false },
      ]),
    ).toBe(true)
  })

  it("is unanswered when zero options are ticked", () => {
    expect(
      isAnswered([
        { checked: false, text: "Option A", freeText: false },
        { checked: false, text: "Option B", freeText: false },
      ]),
    ).toBe(false)
  })

  it("is unanswered when two or more options are ticked at once — the exact divergence a client re-deriving 'take the first checked option' would miss", () => {
    expect(
      isAnswered([
        { checked: true, text: "Option A", freeText: false },
        { checked: true, text: "Option B", freeText: false },
      ]),
    ).toBe(false)
  })

  it("is unanswered when the ticked option is the free-text slot with empty text", () => {
    expect(isAnswered([{ checked: true, text: "", freeText: true }])).toBe(false)
  })

  it("is answered when the ticked option is the free-text slot WITH text", () => {
    expect(isAnswered([{ checked: true, text: "a real answer", freeText: true }])).toBe(true)
  })
})

describe("qa.view", () => {
  const CONTENT = [
    "Plan.",
    "",
    "## Open Questions",
    "",
    "### First?",
    "",
    "- [ ] Option A",
    "- [ ] Option B",
    "",
    "## Answered Questions",
    "",
    "### Second?",
    "",
    "Already decided.",
    "",
  ].join("\n")

  it("exposes both open and answered questions, in document order — title carries the actual question, detail the body summary", () => {
    const view = qa.view(CONTENT)
    const questionNodes = view.nodes.filter((n) => n.status !== undefined)
    expect(questionNodes.map((q) => [q.status, q.title, q.detail])).toEqual([
      ["open", "First?", "- [ ] Option A"],
      ["answered", "Second?", "Already decided."],
    ])
    expect(questionNodes[0]!.children!.map((o) => o.title)).toEqual(["Option A", "Option B"])
  })

  it("prepends the plan's own lead prose (before '## Open Questions') as a paragraph node, ahead of every question (requirement 4/T5's 'Read the plan' row needs an actual plan to read)", () => {
    const view = qa.view(CONTENT)
    expect(view.nodes[0]).toMatchObject({ title: "Plan.", anchor: { kind: "paragraph", line: 0 } })
    expect(view.nodes[0]!.status).toBeUndefined()
    expect(view.nodes.slice(1).every((n) => n.status !== undefined)).toBe(true)
  })

  it("is built from one parse of the document, not one per element", () => {
    const uniqueContent = [
      "Plan two.",
      "",
      "## Open Questions",
      "",
      "### Solo?",
      "",
      "- [ ] Only option",
      "",
    ].join("\n")
    const before = getParseCount()
    qa.view(uniqueContent)
    expect(getParseCount()).toBe(before + 1)
  })
})

describe("qa.view — prose-only projection (T2, no Open/Answered Questions section at all)", () => {
  it("yields one paragraph node per paragraph, and no questions", () => {
    const content = ["First paragraph of the plan.", "", "Second paragraph, more detail.", ""].join(
      "\n",
    )
    const view = qa.view(content)
    expect(view.nodes.every((n) => n.status === undefined)).toBe(true)
    expect(view.nodes.map((n) => n.title)).toEqual([
      "First paragraph of the plan.",
      "Second paragraph, more detail.",
    ])
  })

  it("each paragraph node's anchor is a real, server-computed {kind:'paragraph', line} at the paragraph's own start line", () => {
    const content = ["Line zero paragraph.", "", "Line two paragraph.", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes.map((n) => n.anchor)).toEqual([
      { kind: "paragraph", line: 0 },
      { kind: "paragraph", line: 2 },
    ])
  })

  it("a paragraph anchor round-trips through annotate/resolve — attaching a note at the projected line actually lands", () => {
    const content = ["A paragraph worth commenting on.", ""].join("\n")
    const result = qa.annotate(content, { kind: "paragraph", line: 0 }, "a real comment")
    expect(result.ok).toBe(true)
  })

  it("a paragraph already carrying a footnote at its own start line surfaces it as that node's own note, for editing rather than a second note", () => {
    const content = [
      "A paragraph with a note attached.[^fn1]",
      "",
      "[^fn1]: the reviewer's own comment",
      "",
    ].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.note).toBe("the reviewer's own comment")
  })

  it("a document with an Open Questions section is NOT treated as prose-only, even with prose before it", () => {
    const content = [
      "Some intro prose.",
      "",
      "## Open Questions",
      "",
      "### First?",
      "",
      "- [ ] Option A",
      "",
    ].join("\n")
    const view = qa.view(content)
    // NOT prose-only: the real question node is still there — but its own
    // intro prose is now ALSO a node (a separate, `undefined`-status
    // paragraph node), never dropped.
    expect(view.nodes.map((n) => n.status)).toEqual([undefined, "open"])
    expect(view.nodes[0]).toMatchObject({
      title: "Some intro prose.",
      anchor: { kind: "paragraph", line: 0 },
    })
  })
})

describe("qa.view — block nodes (package 02, T1/T2)", () => {
  it("a heading, a nested list, a fenced code block, a blockquote and two paragraphs yield six block nodes, in document order", () => {
    const content = [
      "# Heading",
      "",
      "- Item one",
      "  - Nested item",
      "",
      "```",
      "line one",
      "line two",
      "```",
      "",
      "> A blockquote.",
      "",
      "Paragraph one.",
      "",
      "Paragraph two.",
      "",
    ].join("\n")
    const view = qa.view(content)
    expect(view.nodes.map((n) => n.block?.kind)).toEqual([
      "heading",
      "list",
      "code",
      "blockquote",
      "paragraph",
      "paragraph",
    ])
  })

  it("yields block nodes for the prose BEFORE the questions section and for every block AFTER it, and none for any block inside a question's own span", () => {
    // A question's own body span runs up to the NEXT heading of any depth
    // (`questionEndLines`/`splitQuestionBlocks`'s existing rule) — so genuine
    // trailing content past the LAST question needs a heading of its own
    // (here a `####`, neither a section heading nor a question heading) to
    // stop that span; without one it reads as part of the last question's own
    // body, which is exactly what this test's OWN "none inside a question's
    // span" half already covers via "Already decided."/"Option A".
    const content = [
      "Lead prose.",
      "",
      "## Open Questions",
      "",
      "### First?",
      "",
      "- [ ] Option A",
      "",
      "## Answered Questions",
      "",
      "### Second?",
      "",
      "Already decided.",
      "",
      "#### Note",
      "",
      "Trailing prose.",
      "",
    ].join("\n")
    const view = qa.view(content)
    const proseTitles = view.nodes.filter((n) => n.status === undefined).map((n) => n.title)
    expect(proseTitles).toEqual(["Lead prose.", "Note", "Trailing prose."])
    // "Already decided." is the ANSWERED question's own body text — never a
    // second, competing block node alongside that question's own node.
    expect(proseTitles).not.toContain("Already decided.")
    expect(proseTitles).not.toContain("Option A")
  })

  it("neither the '## Open Questions' nor the '## Answered Questions' heading is ever itself a block node", () => {
    const content = [
      "## Open Questions",
      "",
      "### First?",
      "",
      "- [ ] Option A",
      "",
      "## Answered Questions",
      "",
      "### Second?",
      "",
      "Already decided.",
      "",
    ].join("\n")
    const view = qa.view(content)
    expect(view.nodes.map((n) => n.title)).not.toContain("Open Questions")
    expect(view.nodes.map((n) => n.title)).not.toContain("Answered Questions")
  })

  it("a prose-only document yields the same block nodes and zero question nodes", () => {
    const content = ["# Heading", "", "Paragraph.", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes.every((n) => n.status === undefined)).toBe(true)
    expect(view.nodes.map((n) => n.block?.kind)).toEqual(["heading", "paragraph"])
  })

  it("a heading node carries block.kind 'heading' and its real depth", () => {
    const content = ["### A level-3 heading", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block).toMatchObject({ kind: "heading", depth: 3 })
  })

  it("a list node carries block.kind 'list', its ordered flag, and an items tree whose nesting matches the source — two levels deep for a list nested two deep", () => {
    const content = ["- Top item", "  - Nested item", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block).toMatchObject({
      kind: "list",
      ordered: false,
      items: [{ text: "Top item", items: [{ text: "Nested item" }] }],
    })
  })

  it("an ordered list node carries ordered: true", () => {
    const content = ["1. First", "2. Second", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block).toMatchObject({ kind: "list", ordered: true })
  })

  it("a list item with a nested list AND a trailing paragraph of its own yields text containing neither the nested item's text nor its '-' marker, with that item present exactly once in the items tree", () => {
    const content = ["- Top", "", "  - Nested", "", "  Tail para.", ""].join("\n")
    const view = qa.view(content)
    const topItem = view.nodes[0]?.block?.items?.[0]
    expect(topItem?.text).toBe("Top Tail para.")
    expect(topItem?.text).not.toContain("Nested")
    expect(topItem?.text).not.toContain("-")
    expect(topItem?.items).toEqual([{ text: "Nested" }])
  })

  it("a task-list item carries its checked state on the item", () => {
    const content = ["- [ ] Not done", "- [x] Done", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block?.items).toEqual([
      { text: "Not done", checked: false },
      { text: "Done", checked: true },
    ])
  })

  it("a fenced code block carries block.kind 'code', its language from the info string, and its body verbatim — leading whitespace intact", () => {
    const content = ["```ts", "  const x = 1", "const y = 2", "```", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block).toMatchObject({
      kind: "code",
      language: "ts",
      text: "  const x = 1\nconst y = 2",
    })
  })

  it("a fenced code block with no info string carries no language field", () => {
    const content = ["```", "plain", "```", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block?.language).toBeUndefined()
  })

  it("a fenced code block with an empty body still carries a non-empty title", () => {
    const content = ["```", "```", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block).toMatchObject({ kind: "code", text: "" })
    expect(view.nodes[0]?.title.length).toBeGreaterThan(0)
  })

  it("a blockquote carries block.kind 'blockquote' and its text", () => {
    const content = ["> Quoted wisdom.", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block).toMatchObject({ kind: "blockquote", text: "Quoted wisdom." })
  })

  it("a blockquote spanning two paragraphs carries text with no '>' character in it", () => {
    const content = ["> First line.", ">", "> Second para.", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block?.text).not.toContain(">")
    expect(view.nodes[0]?.block?.text).toBe("First line. Second para.")
  })

  it("every node still carries a non-empty title", () => {
    const content = [
      "# Heading",
      "",
      "- Item",
      "",
      "```",
      "code",
      "```",
      "",
      "> Quote.",
      "",
      "Paragraph.",
      "",
    ].join("\n")
    const view = qa.view(content)
    expect(view.nodes.every((n) => n.title.length > 0)).toBe(true)
  })
})

/** Applies edits back-to-front — a local copy of the file's own `applyEdits` (defined further down, after `qa.apply`'s own describe block) so this earlier suite can assert on the resulting document text too. */
const applyEditsLocal = (
  content: string,
  edits: readonly {
    readonly range: {
      readonly start: { readonly line: number; readonly character: number }
      readonly end: { readonly line: number; readonly character: number }
    }
    readonly newText: string
  }[],
): string => {
  const lines = content.split("\n")
  const toOffset = (pos: { readonly line: number; readonly character: number }): number => {
    let offset = 0
    for (let i = 0; i < pos.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
    return offset + pos.character
  }
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
  let result = content
  for (const edit of sorted) {
    result =
      result.slice(0, toOffset(edit.range.start)) +
      edit.newText +
      result.slice(toOffset(edit.range.end))
  }
  return result
}

describe("qa.annotate/note — block anchors carry structure beyond paragraphs (package 02, T3)", () => {
  it("annotate with a paragraph anchor at a heading's start line attaches the marker at the end of that heading's own line and the definition after the heading's own block", () => {
    const content = ["# Heading", "", "Body text.", ""].join("\n")
    const result = qa.annotate(content, { kind: "paragraph", line: 0 }, "a note on the heading")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const markerEdit = result.edits.find((e) => e.range.start.line === 0)
    expect(markerEdit?.newText).toContain("[^")
    const applied = applyEditsLocal(content, result.edits)
    expect(applied.split("\n")[0]).toBe(`# Heading${markerEdit?.newText}`)
    expect(qa.validate(applied).length).toBe(0)
  })

  it("annotate with a paragraph anchor at a list's start line and at a blockquote's start line each succeed, and the resulting document still passes validate with zero findings", () => {
    const listContent = ["- Item one", "- Item two", ""].join("\n")
    const listResult = qa.annotate(listContent, { kind: "paragraph", line: 0 }, "note on list")
    expect(listResult.ok).toBe(true)
    if (listResult.ok) {
      expect(qa.validate(applyEditsLocal(listContent, listResult.edits)).length).toBe(0)
    }

    const quoteContent = ["> A quote.", ""].join("\n")
    const quoteResult = qa.annotate(quoteContent, { kind: "paragraph", line: 0 }, "note on quote")
    expect(quoteResult.ok).toBe(true)
    if (quoteResult.ok) {
      expect(qa.validate(applyEditsLocal(quoteContent, quoteResult.edits)).length).toBe(0)
    }
  })

  it("a block node that already carries a footnote marker on its start line surfaces that note as `note`, for every block kind — not just paragraphs", () => {
    const content = [
      "# Heading with a note[^fn1]",
      "",
      "[^fn1]: the reviewer's own comment",
      "",
    ].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]?.block?.kind).toBe("heading")
    expect(view.nodes[0]?.note).toBe("the reviewer's own comment")
  })

  // `annotate` deliberately keeps no code-block branch (Task 3's own point):
  // `footnoteAttachEdits` puts a marker at the end of the anchor line, which
  // for a code block IS the opening fence — attaching there WOULD corrupt
  // it. Nothing here prevents that call from succeeding; the server still
  // emits the code block's own `{kind:"paragraph", line}` anchor like every
  // other node (below), and it is the CLIENT's job (`ProseBlock`, Task 4)
  // to never offer the seam that would produce this call in the first place.
  it("a code block still carries a real {kind:'paragraph', line} anchor — the same kind every other block carries, no separate anchor kind for code", () => {
    const content = ["```", "line one", "```", ""].join("\n")
    const view = qa.view(content)
    expect(view.nodes[0]).toMatchObject({
      block: { kind: "code" },
      anchor: { kind: "paragraph", line: 0 },
    })
  })
})

describe("qa.annotate", () => {
  const CONTENT = ["## Open Questions", "", "### First?", "", "- [ ] Option A", ""].join("\n")

  it("accepts a question anchor", () => {
    expect(qa.annotate(CONTENT, { kind: "question", index: 0 }, "a real note").ok).toBe(true)
  })

  it("accepts an option anchor", () => {
    expect(
      qa.annotate(CONTENT, { kind: "option", questionIndex: 0, index: 0 }, "a real note").ok,
    ).toBe(true)
  })

  it("accepts a paragraph anchor in a prose-only document", () => {
    expect(
      qa.annotate("Just some prose.\n", { kind: "paragraph", line: 0 }, "a real note").ok,
    ).toBe(true)
  })

  it("rejects an anchor that no longer resolves, rather than silently dropping it", () => {
    expect(qa.annotate(CONTENT, { kind: "question", index: 5 }, "note")).toEqual({
      ok: false,
      reason: "anchor-not-found",
    })
    expect(qa.annotate(CONTENT, { kind: "chunk", index: 0 }, "note")).toEqual({
      ok: false,
      reason: "anchor-not-found",
    })
  })

  it("attaches the given text verbatim, and the resulting document passes its own format's validator (T2's last criterion)", () => {
    const result = qa.annotate(
      CONTENT,
      { kind: "option", questionIndex: 0, index: 0 },
      "a real reason a human actually typed",
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lines = CONTENT.split("\n")
    const toOffset = (pos: { readonly line: number; readonly character: number }): number => {
      let offset = 0
      for (let i = 0; i < pos.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
      return offset + pos.character
    }
    const sorted = [...result.edits].sort(
      (a, b) => toOffset(b.range.start) - toOffset(a.range.start),
    )
    let applied = CONTENT
    for (const edit of sorted) {
      applied =
        applied.slice(0, toOffset(edit.range.start)) +
        edit.newText +
        applied.slice(toOffset(edit.range.end))
    }
    expect(applied).toContain("a real reason a human actually typed")
    expect(applied).not.toContain("your comment")
    expect(qa.validate(applied)).toEqual([])
  })
})

/** Applies edits back-to-front (as `ui/Write.ts#applySteeringEdits` does) — local to this test file so `apply` tests can assert on the resulting document text, mirroring the `annotate` describe block above's own inline `toOffset`/splice pattern. */
const applyEdits = (
  content: string,
  edits: readonly {
    readonly range: {
      readonly start: { readonly line: number; readonly character: number }
      readonly end: { readonly line: number; readonly character: number }
    }
    readonly newText: string
  }[],
): string => {
  const lines = content.split("\n")
  const toOffset = (pos: { readonly line: number; readonly character: number }): number => {
    let offset = 0
    for (let i = 0; i < pos.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
    return offset + pos.character
  }
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
  let result = content
  for (const edit of sorted) {
    result =
      result.slice(0, toOffset(edit.range.start)) +
      edit.newText +
      result.slice(toOffset(edit.range.end))
  }
  return result
}

describe("qa.apply", () => {
  const CONTENT = [
    "## Open Questions",
    "",
    "### First?",
    "",
    "- [x] Option A",
    "- [ ] Option B",
    `- [ ] ${FREE_TEXT_PLACEHOLDER}`,
    "",
  ].join("\n")

  it("radio: ticking one option unticks an already-ticked sibling", () => {
    const result = qa.apply(
      CONTENT,
      { kind: "option", questionIndex: 0, index: 1 },
      {
        checked: true,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const applied = applyEdits(CONTENT, result.edits)
    const { questions } = parseOpenQuestions(applied)
    expect(questions[0]!.options.map((o) => o.checked)).toEqual([false, true, false])
  })

  it("ticking the free-text slot with text sets both the tick and the label in one edit set", () => {
    const result = qa.apply(
      CONTENT,
      { kind: "option", questionIndex: 0, index: 2 },
      {
        checked: true,
        text: "my real answer",
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const applied = applyEdits(CONTENT, result.edits)
    const { questions } = parseOpenQuestions(applied)
    expect(questions[0]!.options[2]).toMatchObject({ checked: true, text: "my real answer" })
    // radio semantics fired too: Option A (already ticked) is now unticked
    expect(questions[0]!.options[0]!.checked).toBe(false)
  })

  it("trims trailing whitespace off a typed free-text answer, so the written label stays an oxfmt fixed point", () => {
    const result = qa.apply(
      CONTENT,
      { kind: "option", questionIndex: 0, index: 2 },
      {
        checked: true,
        text: "my real answer   ",
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const applied = applyEdits(CONTENT, result.edits)
    const { questions } = parseOpenQuestions(applied)
    expect(questions[0]!.options[2]).toMatchObject({ checked: true, text: "my real answer" })
    expect(applied).not.toMatch(/ +\n/)
  })

  it("collapses interior newlines in a typed free-text answer to a single line, so the written label stays an oxfmt fixed point", () => {
    const result = qa.apply(
      CONTENT,
      { kind: "option", questionIndex: 0, index: 2 },
      {
        checked: true,
        text: "line one\nline two",
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const applied = applyEdits(CONTENT, result.edits)
    const { questions } = parseOpenQuestions(applied)
    expect(questions[0]!.options[2]).toMatchObject({ checked: true, text: "line one line two" })
    // The option's own line count must stay exactly one — a real newline
    // spliced into the label would split it into two markdown lines, one of
    // them unindented free-floating text no longer inside the list item.
    expect(applied.split("\n").filter((line) => line.includes("line one"))).toHaveLength(1)
  })

  it("erasing a free-text answer ({checked: false, text: \"\"}) restores the placeholder, and the option is still writable afterward — never a dead 'anchor-not-found' anchor", () => {
    // Seed a question whose free-text slot already carries a real typed
    // answer — mirrors what `ticking the free-text slot with text` above
    // just wrote.
    const answered = applyEdits(
      CONTENT,
      (() => {
        const first = qa.apply(
          CONTENT,
          { kind: "option", questionIndex: 0, index: 2 },
          { checked: true, text: "my typed answer" },
        )
        if (!first.ok) throw new Error("setup apply failed")
        return first.edits
      })(),
    )
    expect(parseOpenQuestions(answered).questions[0]!.options[2]).toMatchObject({
      checked: true,
      text: "my typed answer",
    })

    const erase = qa.apply(
      answered,
      { kind: "option", questionIndex: 0, index: 2 },
      { checked: false, text: "" },
    )
    expect(erase.ok).toBe(true)
    if (!erase.ok) return
    const erased = applyEdits(answered, erase.edits)
    // Package 03's own bug: an empty label ("- [ ] ") leaves nothing for
    // `optionContentOffset` to find, so this must NOT literally write "".
    expect(erased).toContain(`- [ ] ${FREE_TEXT_PLACEHOLDER}`)
    expect(parseOpenQuestions(erased).questions[0]!.options[2]).toMatchObject({
      checked: false,
      text: "",
    })

    // The anchor must still resolve — a real retype after an erase, the
    // round trip a human erasing-then-retyping on the phone depends on.
    const retype = qa.apply(
      erased,
      { kind: "option", questionIndex: 0, index: 2 },
      { checked: true, text: "a new answer" },
    )
    expect(retype.ok).toBe(true)
    if (!retype.ok) return
    const retyped = applyEdits(erased, retype.edits)
    expect(parseOpenQuestions(retyped).questions[0]!.options[2]).toMatchObject({
      checked: true,
      text: "a new answer",
    })
  })

  it("a stale option index refuses anchor-not-found", () => {
    expect(
      qa.apply(CONTENT, { kind: "option", questionIndex: 0, index: 99 }, { checked: true }),
    ).toEqual({ ok: false, reason: "anchor-not-found" })
  })

  it("a hunk/chunk anchor — not this format's own kind — refuses anchor-not-found", () => {
    expect(qa.apply(CONTENT, { kind: "chunk", index: 0 }, { checked: true })).toEqual({
      ok: false,
      reason: "anchor-not-found",
    })
    expect(qa.apply(CONTENT, { kind: "hunk", chunkIndex: 0, index: 0 }, { checked: true })).toEqual(
      { ok: false, reason: "anchor-not-found" },
    )
  })
})
