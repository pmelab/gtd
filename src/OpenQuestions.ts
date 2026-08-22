import type { SteeringEdit, SteeringFormat, SteeringOutlineNode } from "./SteeringFormat.js"

export type OpenQuestionStatus = "open" | "answered"

/**
 * The sentinel an UNFILLED free-text option carries — the human answers by
 * REPLACING it with their own text and ticking that line. The parser
 * normalizes a last-option text equal to this to `""`, so a ticked-but-
 * unfilled free-text option reads as unanswered (see `OpenQuestion.answered`).
 */
export const FREE_TEXT_PLACEHOLDER = "_your answer_"

/** `QA_FORMAT`'s canonical sample: one open question with two options plus the unfilled free-text slot. Not authored to survive any particular formatter. */
const QA_SAMPLE = `Sample plan. Add a thing.

## Open Questions

### Which option?

- [ ] Option A
- [ ] Option B
- [ ] ${FREE_TEXT_PLACEHOLDER}
`

/** One checkbox option under an OPEN question: its ticked state, its text (the free-text placeholder normalized to `""`), and its source line span for editor tooling. */
export interface QuestionOption {
  readonly checked: boolean
  /** Text after the `- [ ]`/`- [x]` marker, trimmed. The unfilled free-text placeholder (`FREE_TEXT_PLACEHOLDER`) normalizes to `""`. */
  readonly text: string
  /** `true` for the LAST option of the block — the free-text "your answer" slot (identified positionally, not by label). */
  readonly freeText: boolean
  readonly sourceLine: number
  /** 0-based line index of the LAST line of this option's list item — equal to `sourceLine` unless the item's text wraps onto continuation lines. */
  readonly endLine: number
}

export interface OpenQuestion {
  readonly question: string
  readonly status: OpenQuestionStatus
  /** First non-blank body line (trimmed), or `""` — a short summary for editor tooling. */
  readonly text: string
  readonly headingLine: number
  /** Checkbox options in document order. `[]` for an ANSWERED question (prose, no checkboxes). The LAST option is the free-text slot. */
  readonly options: readonly QuestionOption[]
  /**
   * `true` when this OPEN question is fully answered: EXACTLY ONE option is
   * ticked, and if that's the free-text slot its text is non-empty. Always
   * `false` for a question with no options and for an answered question.
   */
  readonly answered: boolean
}

export interface OpenQuestionsDoc {
  readonly questions: readonly OpenQuestion[]
  readonly errors: readonly string[]
}

const OPEN_QUESTIONS_HEADING = "## Open Questions"
const ANSWERED_QUESTIONS_HEADING = "## Answered Questions"

interface Heading {
  readonly level: number
  /** Heading text with the `#` run and surrounding whitespace stripped — `""` for a bare `###`. */
  readonly text: string
}

/**
 * Parses an ATX heading, or `undefined` when the line isn't one. A bare
 * `### ` is a level-3 heading with empty `text` on purpose — a heading with no
 * question text is the one structural error this format reports, so it must
 * be recognised rather than skipped as prose.
 */
const parseHeading = (line: string): Heading | undefined => {
  const match = /^(#{1,6})(?:\s+(.*))?$/.exec(line.trim())
  return match ? { level: match[1]!.length, text: (match[2] ?? "").trim() } : undefined
}

/** One `###` heading under a questions section, with its raw body lines (up to the next heading of any level). */
interface QuestionBlock {
  readonly question: string
  readonly headingLine: number
  readonly body: readonly string[]
}

/** Splits the lines after a `## ... Questions` heading into consecutive `###` blocks. Stops at the next level-1/2 heading or EOF. */
const splitQuestionBlocks = (lines: readonly string[], start: number): readonly QuestionBlock[] => {
  const blocks: QuestionBlock[] = []
  let i = start

  while (i < lines.length) {
    const heading = parseHeading(lines[i]!)
    if (heading !== undefined && heading.level <= 2) break

    if (heading?.level !== 3) {
      i += 1
      continue
    }

    const question = heading.text
    const headingLine = i
    i += 1
    const body: string[] = []
    while (i < lines.length && parseHeading(lines[i]!) === undefined) {
      body.push(lines[i]!)
      i += 1
    }
    blocks.push({ question, headingLine, body })
  }

  return blocks
}

/** A markdown task-list checkbox line: `- [ ]` / `- [x]` / `* [X]`, optional leading indent, optional trailing text. */
const CHECKBOX_RE = /^\s*[-*]\s*\[([ xX])\]\s?(.*)$/

/**
 * The body index of the last line belonging to the list item that starts at
 * `index`: the run of following lines that are neither blank nor a checkbox of
 * their own. Indentation is NOT required — an unindented lazy wrap is as much
 * part of the item as an indented one.
 */
const itemEndIndex = (body: readonly string[], index: number): number => {
  let end = index
  for (let i = index + 1; i < body.length; i += 1) {
    const line = body[i]!
    if (line.trim().length === 0 || CHECKBOX_RE.test(line)) break
    end = i
  }
  return end
}

/**
 * Extracts the checkbox options from a question block's body, in document
 * order. `bodyStart` is the absolute line index of `body[0]`, so each option
 * carries its true source line and span.
 */
const parseOptions = (body: readonly string[], bodyStart: number): QuestionOption[] => {
  const raw: { checked: boolean; text: string; sourceLine: number; bodyIndex: number }[] = []
  body.forEach((line, i) => {
    const match = CHECKBOX_RE.exec(line)
    if (!match) return
    raw.push({
      checked: match[1] !== " ",
      text: match[2]!.trim(),
      sourceLine: bodyStart + i,
      bodyIndex: i,
    })
  })
  const lastIndex = raw.length - 1
  return raw.map((option, i) => {
    const freeText = i === lastIndex
    const normalized =
      freeText && option.text.trim().toLowerCase() === FREE_TEXT_PLACEHOLDER ? "" : option.text
    return {
      checked: option.checked,
      text: normalized,
      freeText,
      sourceLine: option.sourceLine,
      endLine: bodyStart + itemEndIndex(body, option.bodyIndex),
    }
  })
}

/**
 * An OPEN question is answered iff EXACTLY ONE option is ticked and — when that
 * option is the free-text slot — its (placeholder-normalized) text is non-empty.
 * Zero ticks (unanswered), two+ ticks (ambiguous), or a ticked-but-empty
 * free-text slot all read as not answered.
 */
const isAnswered = (options: readonly QuestionOption[]): boolean => {
  const ticked = options.filter((o) => o.checked)
  if (ticked.length !== 1) return false
  const chosen = ticked[0]!
  return !(chosen.freeText && chosen.text.length === 0)
}

const parseQuestionBlock = (
  block: QuestionBlock,
  status: OpenQuestionStatus,
): OpenQuestion | { readonly error: string } => {
  if (block.question.length === 0) {
    return {
      error:
        "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
    }
  }

  const firstNonBlank = block.body.map((line) => line.trim()).find((line) => line.length > 0) ?? ""
  const options = status === "open" ? parseOptions(block.body, block.headingLine + 1) : []

  return {
    question: block.question,
    status,
    text: firstNonBlank,
    headingLine: block.headingLine,
    options,
    answered: status === "open" && options.length > 0 && isAnswered(options),
  }
}

/**
 * Parses the open-questions structure out of `content`. Total and
 * side-effect-free: always returns a result, never throws. Questions are
 * returned in document order (by heading line) regardless of which section
 * comes first.
 */
export const parseOpenQuestions = (content: string): OpenQuestionsDoc => {
  const lines = content.split(/\r?\n/)

  const questions: OpenQuestion[] = []
  const errors: string[] = []

  const sections: readonly (readonly [string, OpenQuestionStatus])[] = [
    [OPEN_QUESTIONS_HEADING, "open"],
    [ANSWERED_QUESTIONS_HEADING, "answered"],
  ]

  for (const [heading, status] of sections) {
    const headingIndex = lines.findIndex((line) => line.trim() === heading)
    if (headingIndex === -1) continue
    for (const block of splitQuestionBlocks(lines, headingIndex + 1)) {
      const result = parseQuestionBlock(block, status)
      if ("error" in result) {
        errors.push(result.error)
      } else {
        questions.push(result)
      }
    }
  }

  questions.sort((a, b) => a.headingLine - b.headingLine)
  return { questions, errors }
}

/** Every OPEN question that is not answered — the answer-completeness guard (`src/StepGuards.ts`) refuses a step while this is non-empty. */
export const unansweredQuestions = (content: string): readonly OpenQuestion[] =>
  parseOpenQuestions(content).questions.filter((q) => q.status === "open" && !q.answered)

/** Flips the checkbox on `line`, preserving the rest of the line exactly. `undefined` when the line has no LIST-MARKER checkbox — a bare `[x]` in ordinary prose doesn't count. */
export const toggleCheckbox = (content: string, line: number): SteeringEdit | undefined => {
  const raw = content.split(/\r?\n/)[line]
  if (raw === undefined) return undefined
  const match = CHECKBOX_RE.exec(raw)
  if (!match) return undefined
  const character = raw.indexOf("[") + 1
  return {
    range: { start: { line, character }, end: { line, character: character + 1 } },
    newText: match[1] === " " ? "x" : " ",
  }
}

const lineRange = (lines: readonly string[], line: number) => ({
  start: { line, character: 0 },
  end: { line, character: (lines[line] ?? "").length },
})

const spanRange = (lines: readonly string[], startLine: number, endLine: number) => ({
  start: { line: startLine, character: 0 },
  end: { line: endLine, character: (lines[endLine] ?? "").length },
})

/** The outline marker for one question — `[unanswered]` entries are exactly the questions still blocking the answer-completeness gate. */
const statusMarker = (question: OpenQuestion): string => {
  if (question.status === "answered") return "[answered]"
  return question.answered ? "[answered]" : "[unanswered]"
}

/** The outline tree for a `qa`-mode file's open/answered questions, each option a `leaf: true` child of its open question. */
const questionsOutline = (content: string): readonly SteeringOutlineNode[] => {
  const { questions } = parseOpenQuestions(content)
  const lines = content.split(/\r?\n/)
  return questions.map((question, i) => {
    const start = question.headingLine
    const end = Math.max(start, (questions[i + 1]?.headingLine ?? lines.length) - 1)
    const children: SteeringOutlineNode[] = question.options.map((option) => ({
      name: `${option.checked ? "[x]" : "[ ]"} ${option.text || "your answer"}`,
      range: spanRange(lines, option.sourceLine, option.endLine),
      selectionRange: lineRange(lines, option.sourceLine),
      leaf: true,
    }))
    return {
      name: `${statusMarker(question)} ${question.question}`,
      detail: question.text,
      range: spanRange(lines, start, end),
      selectionRange: lineRange(lines, start),
      ...(children.length > 0 ? { children } : {}),
    }
  })
}

/** The edits that make `option` the sole ticked option in `question` (radio semantics): check it, and uncheck any already-ticked sibling — so the question ends with exactly one tick (what the completeness gate wants). */
const pickOptionEdits = (
  content: string,
  question: OpenQuestion,
  option: QuestionOption,
): SteeringEdit[] => {
  const edits: SteeringEdit[] = []
  for (const sibling of question.options) {
    if (sibling.sourceLine !== option.sourceLine && !sibling.checked) continue
    const edit = toggleCheckbox(content, sibling.sourceLine)
    if (edit) edits.push(edit)
  }
  return edits
}

/** The single action for the option line the cursor sits on: uncheck it if ticked, else pick it (radio). `undefined` when there is no edit to make. */
const optionAction = (
  content: string,
  question: OpenQuestion,
  option: QuestionOption,
): { readonly title: string; readonly edits: readonly SteeringEdit[] } | undefined => {
  const edits = option.checked
    ? [toggleCheckbox(content, option.sourceLine)].filter((e): e is SteeringEdit => e !== undefined)
    : pickOptionEdits(content, question, option)
  if (edits.length === 0) return undefined
  return { title: option.checked ? "gtd: uncheck this option" : "gtd: pick this option", edits }
}

/**
 * Actions for a `qa`-mode file: anywhere on an open question's option's list
 * item, "pick this option" (radio semantics) or "uncheck this option" when
 * it's already chosen. No action off an option's span, or on an
 * answered-section (prose) question.
 */
const questionActions: SteeringFormat["actions"] = (content, range) => {
  const { questions } = parseOpenQuestions(content)
  const cursorLine = range.start.line
  const actions: Array<{ readonly title: string; readonly edits: readonly SteeringEdit[] }> = []
  for (const question of questions) {
    if (question.status !== "open") continue
    const option = question.options.find(
      (o) => cursorLine >= o.sourceLine && cursorLine <= o.endLine,
    )
    if (!option) continue
    const action = optionAction(content, question, option)
    if (action) actions.push(action)
  }
  return actions
}

/** The `qa` steering format: gtd's own in-process open-questions checkbox format — validation, outline, and code actions, no `pointerAt` (an open question's options have nothing to jump to). Its one finding is always positionless — this format has no notion of a per-line problem. */
export const QA_FORMAT: SteeringFormat = {
  sample: QA_SAMPLE,
  validate: (content) => parseOpenQuestions(content).errors.map((message) => ({ message })),
  outline: questionsOutline,
  actions: questionActions,
}
