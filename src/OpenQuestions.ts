/**
 * Pure parser/validator for the "open questions" structure `.gtd/TODO.md`
 * follows in the bundled default v3 workflow's `grilling`/`grilling-answer`
 * loop (see `src/workflows/default.yaml` and
 * `docs/design/steering-file-loops.md` §1) — and for any custom workflow that
 * reuses the same file/format.
 *
 * Format: free-form prose, plus an OPTIONAL `## Open Questions` section
 * (omitted entirely = zero open questions, not an error). Every `###`
 * sub-heading directly under that section is one open question; its body's
 * first non-blank line must be `Suggested default: <text>` (the agent's
 * unanswered default) or `Answer: <text>` (a human's answer, or the agent
 * folding one in) — anything else is a validation error.
 *
 * **Executable spec ↔ bash validator contract:** this module is the
 * EXECUTABLE SPEC of that format — its own unit tests (`OpenQuestions.test.ts`)
 * are the format's spec tests. `src/workflows/default.yaml`'s
 * `todo-validating` state independently re-implements the SAME rules as a
 * pragmatic bash/awk port (mechanics-only, not a full markdown parser) — see
 * that state's script for the sibling half of this contract. There is no
 * shared code path between the two on purpose: the engine (`PatternMachine`/
 * `Edge`/the bundled workflow) stays git/filesystem/Effect-dependency-free of
 * this module, and this module (and the LSP built on it, `src/Lsp.ts`) stays
 * independent of any particular workflow's shape. Keep both in sync by hand
 * when the format changes.
 *
 * No git, no filesystem, no Effect — trivially unit-testable and safe to call
 * from both the LSP's protocol edge (`src/Lsp.ts`) and any other IO layer that
 * wants to read/validate `.gtd/TODO.md`.
 */

export type OpenQuestionStatus = "suggested" | "answered"

export interface OpenQuestion {
  readonly question: string
  readonly status: OpenQuestionStatus
  readonly text: string
  /** 0-based line index of this question's `###` heading, for editor tooling. */
  readonly headingLine: number
}

export interface OpenQuestionsDoc {
  readonly questions: readonly OpenQuestion[]
  readonly errors: readonly string[]
}

const OPEN_QUESTIONS_HEADING = "## Open Questions"
const RESPONSE_RE = /^(Suggested default|Answer):\s*(.*)$/

/** Leading `#` run length of a heading line, or `undefined` if the (trimmed) line isn't a heading. */
const headingLevel = (line: string): number | undefined => {
  const match = /^(#{1,6})\s+\S.*$/.exec(line.trim())
  return match ? match[1]!.length : undefined
}

/** One `###` heading under `## Open Questions`, with its raw body lines (up to the next heading of any level). */
interface QuestionBlock {
  readonly question: string
  readonly headingLine: number
  readonly body: readonly string[]
}

/**
 * Splits the lines after `## Open Questions` into consecutive `###` blocks.
 * Stops at the next level-1/2 heading (the end of the section) or EOF; a
 * heading deeper than level 3, or plain prose, is skipped as filler between
 * blocks.
 */
const splitQuestionBlocks = (lines: readonly string[], start: number): readonly QuestionBlock[] => {
  const blocks: QuestionBlock[] = []
  let i = start

  while (i < lines.length) {
    const level = headingLevel(lines[i]!)
    if (level !== undefined && level <= 2) break

    if (level !== 3) {
      i += 1
      continue
    }

    const question = lines[i]!.trim()
      .replace(/^#{3}\s+/, "")
      .trim()
    const headingLine = i
    i += 1
    const body: string[] = []
    while (i < lines.length && headingLevel(lines[i]!) === undefined) {
      body.push(lines[i]!)
      i += 1
    }
    blocks.push({ question, headingLine, body })
  }

  return blocks
}

/** Parses one question block into a well-formed `OpenQuestion`, or an error message. */
const parseQuestionBlock = (block: QuestionBlock): OpenQuestion | { readonly error: string } => {
  if (block.question.length === 0) {
    return {
      error: "An '### ' open-question heading under '## Open Questions' has no question text",
    }
  }

  const firstNonBlank = block.body.map((line) => line.trim()).find((line) => line.length > 0)
  const responseMatch = firstNonBlank ? RESPONSE_RE.exec(firstNonBlank) : undefined
  const text = responseMatch?.[2]?.trim() ?? ""
  if (!responseMatch || text.length === 0) {
    return {
      error: `Open question "${block.question}" is missing a "Suggested default: ..." or "Answer: ..." line`,
    }
  }

  return {
    question: block.question,
    status: responseMatch[1] === "Answer" ? "answered" : "suggested",
    text,
    headingLine: block.headingLine,
  }
}

/**
 * Parses the open-questions structure out of `content` (the raw text of
 * `.gtd/TODO.md` or `.gtd/ARCHITECTURE.md`). Total and side-effect-free:
 * always returns a result, never throws. `errors` is non-empty exactly when
 * the document violates the required structure (a `###` question under
 * `## Open Questions` with no recognized response line) — the caller decides
 * what to do with that (the machine refuses the agent's turn capture; the
 * `gtd questions` CLI command just reports it alongside whatever parsed).
 */
export const parseOpenQuestions = (content: string): OpenQuestionsDoc => {
  const lines = content.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => line.trim() === OPEN_QUESTIONS_HEADING)
  if (headingIndex === -1) {
    return { questions: [], errors: [] }
  }

  const questions: OpenQuestion[] = []
  const errors: string[] = []
  for (const block of splitQuestionBlocks(lines, headingIndex + 1)) {
    const result = parseQuestionBlock(block)
    if ("error" in result) {
      errors.push(result.error)
    } else {
      questions.push(result)
    }
  }

  return { questions, errors }
}
