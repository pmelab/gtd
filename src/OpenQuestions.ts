/**
 * Pure parser/validator for the "open questions" structure the ADVANCED flow's
 * steering files (`.gtd/REQUIREMENTS.md`, `.gtd/ARCHITECTURE.md`) follow in the
 * unified template's `product-qa`/`technical-qa` Q&A loops (see
 * `src/workflows/unified.yaml`) —
 * and for any custom workflow that reuses the same file/format. (The SIMPLE
 * flow's `.gtd/TODO.md` plan loop no longer uses this format — it iterates on a
 * plan directly, with no `qa` mode.)
 *
 * Format: free-form prose, plus an OPTIONAL `## Open Questions` section (near
 * the top) and an OPTIONAL `## Answered Questions` section (at the bottom).
 * Every `###` sub-heading directly under one of those sections is one question;
 * its STATUS is POSITIONAL — a `###` under `## Open Questions` is open, one
 * under `## Answered Questions` is answered. The only structural error is a
 * `###` heading with no question text. Either section may be omitted entirely
 * (omitted = zero questions of that status, not an error).
 *
 * An OPEN question's body carries a checkbox list of candidate answers — the
 * advanced flow's agent writes two options plus a trailing free-text slot
 * (`- [ ] _your answer_`, see `FREE_TEXT_PLACEHOLDER`), and the human ticks
 * exactly one. This module parses those options (`OpenQuestion.options`) and
 * derives whether the question is answered (`OpenQuestion.answered`) — the two
 * things the answer-completeness gate (`src/program.ts`) and the LSP outline
 * both read. Base VALIDATION stays loose (the checkbox convention is NOT
 * required — a plain prose body is still valid); the only reported error is the
 * empty-`###` one. An ANSWERED question is prose (the agent drops the checkboxes
 * when it resolves and moves it down), so it carries no options. Each option
 * also carries an `endLine` spanning any wrapped continuation lines
 * (`QuestionOption.endLine`) — for editor tooling only; it feeds no validation
 * and no `answered` decision.
 *
 * A question is answered/accepted by MOVING its `###` block from
 * `## Open Questions` down into `## Answered Questions` — the agent does this on
 * the next `product-qa`/`technical-qa` lap (a human leaving a suggestion untouched IS acceptance;
 * an edit IS the answer — either way the whole batch resolves). Nothing here
 * enforces the move or the section order; that is the producing agent's prompt
 * contract, and this parser only reports the resulting status.
 *
 * **The format's single source of truth.** This module is the EXECUTABLE SPEC
 * of that format — its own unit tests (`OpenQuestions.test.ts`) are the
 * format's spec tests. Both consumers of the format run THIS parser, so there
 * is no second implementation to keep in sync: the `gtd validate` CLI command
 * (`src/program.ts`) parses the resolved state's `qa`-mode file and exits
 * non-zero with the `errors` below, and the LSP (`src/Lsp.ts`) publishes the
 * same `errors` as live diagnostics (and labels each question `[open]` /
 * `[answered]` by its section in the document outline). The engine
 * (`PatternMachine`/`Edge`/the bundled workflow) itself stays
 * git/filesystem/Effect-dependency-free of this module, and this module stays
 * independent of any particular workflow's shape.
 *
 * No git, no filesystem, no Effect — trivially unit-testable and safe to call
 * from both the LSP's protocol edge (`src/Lsp.ts`) and any other IO layer that
 * wants to read/validate a `qa`-mode steering file.
 */

export type OpenQuestionStatus = "open" | "answered"

/**
 * The sentinel an UNFILLED free-text option carries in an OPEN question — the
 * last option line the producing agent renders as `- [ ] _your answer_`. The
 * human answers by REPLACING it with their own text (and ticking that line).
 * The parser normalizes a last-option text equal to this sentinel to `""`
 * (empty), so a ticked-but-unfilled free-text option reads as unanswered (see
 * `OpenQuestion.answered`). A fixed placeholder token, like `ReviewDoc`'s fixed
 * `# Review:`/`<!-- base: -->` markers.
 */
export const FREE_TEXT_PLACEHOLDER = "_your answer_"

/** One checkbox option under an OPEN question: its ticked state, its text (the free-text placeholder normalized to `""`), and its source line span for editor tooling. */
export interface QuestionOption {
  readonly checked: boolean
  /** Text after the `- [ ]`/`- [x]` marker, trimmed. The unfilled free-text placeholder (`FREE_TEXT_PLACEHOLDER`) normalizes to `""`. */
  readonly text: string
  /** `true` for the LAST option of the block — the free-text "your answer" slot (identified positionally, not by label). */
  readonly freeText: boolean
  /** 0-based line index of this option's own `- [ ]`/`- [x]` line, for editor tooling. */
  readonly sourceLine: number
  /** 0-based line index of the LAST line of this option's list item — equal to `sourceLine` for a single-line option, greater when the item's text wraps onto continuation lines. Editor tooling maps a cursor anywhere in `sourceLine..endLine` to this option. */
  readonly endLine: number
}

export interface OpenQuestion {
  readonly question: string
  readonly status: OpenQuestionStatus
  /** First non-blank body line (trimmed), or `""` — a short summary for editor tooling. */
  readonly text: string
  /** 0-based line index of this question's `###` heading, for editor tooling. */
  readonly headingLine: number
  /**
   * The checkbox options parsed from this question's body, in document order.
   * OPEN questions carry these (the agent authors `- [ ]` options + a trailing
   * `- [ ] _your answer_`); ANSWERED questions are prose, so this is `[]` for
   * them. The LAST option is the free-text slot (`freeText: true`).
   */
  readonly options: readonly QuestionOption[]
  /**
   * `true` when this OPEN question is fully answered: EXACTLY ONE option is
   * ticked, and if that option is the free-text slot its text is non-empty (not
   * the unfilled placeholder). Meaningful only for `status === "open"` with at
   * least one option — the answer-completeness gate (`src/program.ts`) and the
   * LSP outline both read it. Always `false` for a question with no options and
   * for an answered question.
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
 * Parses an ATX heading (`#`..`######` followed by a space and text, OR a bare
 * `###` run with no text), or `undefined` when the (trimmed) line isn't a
 * heading. A bare `### ` is a level-3 heading with empty `text` on purpose — an
 * open-question heading with no question text is the one structural error this
 * format reports, so it must be recognised rather than skipped as prose.
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

/**
 * Splits the lines after a `## ... Questions` heading into consecutive `###`
 * blocks. Stops at the next level-1/2 heading (the end of the section) or EOF;
 * a heading deeper than level 3, or plain prose, is skipped as filler between
 * blocks.
 */
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
 * their own (see the span rule in the module doc). Indentation is NOT
 * required — an unindented lazy wrap is as much part of the item as an
 * indented one.
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
 * order. The LAST option is the free-text slot (`freeText: true`); its text is
 * normalized to `""` when it still carries the unfilled `FREE_TEXT_PLACEHOLDER`.
 * `bodyStart` is the absolute 0-based line index of `body[0]` (the line right
 * after the `###` heading), so each option carries its true source line and
 * span (`itemEndIndex`).
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

/** Parses one question block into a well-formed `OpenQuestion`, or an error message. */
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
  // Options are meaningful only for OPEN questions — an ANSWERED question is
  // prose (the agent drops the checkboxes when it resolves and moves it down).
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

/** Every OPEN question that is not answered (see `OpenQuestion.answered`) — the answer-completeness guard (`src/StepGuards.ts`) refuses a step while this is non-empty. */
export const unansweredQuestions = (doc: OpenQuestionsDoc): readonly OpenQuestion[] =>
  doc.questions.filter((q) => q.status === "open" && !q.answered)

/**
 * Parses the open-questions structure out of `content` (the raw text of
 * `.gtd/TODO.md` or `.gtd/ARCHITECTURE.md`). Total and side-effect-free:
 * always returns a result, never throws. `errors` is non-empty exactly when
 * the document violates the required structure (a `###` question under either
 * questions section with no question text) — the caller decides what to do with
 * that (`gtd validate` exits non-zero with them; the LSP publishes them as
 * diagnostics). Questions are returned in document order (by heading line)
 * regardless of which section comes first.
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
