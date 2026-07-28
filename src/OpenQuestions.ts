/**
 * Pure parser/validator for the "open questions" structure `.gtd/TODO.md`
 * follows in the `simple` template's `grilling`/`grilling-answer` loop (see
 * `src/workflows/unified.yaml` and `docs/design/steering-file-loops.md` §1) —
 * and for any custom workflow that reuses the same file/format.
 *
 * Format: free-form prose, plus an OPTIONAL `## Open Questions` section (near
 * the top) and an OPTIONAL `## Answered Questions` section (at the bottom).
 * Every `###` sub-heading directly under one of those sections is one question;
 * its STATUS is POSITIONAL — a `###` under `## Open Questions` is open, one
 * under `## Answered Questions` is answered. There is no per-line marker: a
 * question's body is free-form (the agent's suggested answer for an open one,
 * the settled resolution for an answered one). The only structural error is a
 * `###` heading with no question text. Either section may be omitted entirely
 * (omitted = zero questions of that status, not an error).
 *
 * A question is answered/accepted by MOVING its `###` block from
 * `## Open Questions` down into `## Answered Questions` — the agent does this on
 * the next `grilling` lap (a human leaving a suggestion untouched IS acceptance;
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
 * wants to read/validate `.gtd/TODO.md`.
 */

export type OpenQuestionStatus = "open" | "answered"

export interface OpenQuestion {
  readonly question: string
  readonly status: OpenQuestionStatus
  /** First non-blank body line (trimmed), or `""` — a short summary for editor tooling. */
  readonly text: string
  /** 0-based line index of this question's `###` heading, for editor tooling. */
  readonly headingLine: number
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

  return {
    question: block.question,
    status,
    text: firstNonBlank,
    headingLine: block.headingLine,
  }
}

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
