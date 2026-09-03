import type { Code, Heading, List, ListItem, Root, RootContent } from "mdast"
import type { FootnoteMarker } from "./Footnotes.js"
import {
  footnoteAdditionEdits,
  footnotePointerAt,
  isOnExistingFootnote,
  parseFootnotes,
  stripFootnoteMarkers,
} from "./Footnotes.js"
import {
  blockNodeAt,
  parseMarkdown,
  sourceText,
  taskItems,
  toLspPosition,
  toLspPositionFromOffset,
} from "./MarkdownTree.js"
import type {
  SteeringEdit,
  SteeringFinding,
  SteeringFormat,
  SteeringOutlineNode,
} from "./SteeringFormat.js"

export type OpenQuestionStatus = "open" | "answered"

/**
 * The sentinel an UNFILLED free-text option carries — the human answers by
 * REPLACING it with their own text and ticking that line. The parser
 * normalizes a last-option text equal to this to `""`, so a ticked-but-
 * unfilled free-text option reads as unanswered (see `OpenQuestion.answered`).
 */
export const FREE_TEXT_PLACEHOLDER = "_your answer_"

/**
 * `QA_FORMAT`'s canonical sample: one open question with two options plus the
 * unfilled free-text slot, and one anchored footnote on an option with a body
 * over 80 characters — pinned already in oxfmt's own wrapped four-space form
 * (see `src/SteeringFormats.test.ts`'s formatter round-trip). Not authored to
 * survive any particular formatter.
 */
const QA_SAMPLE = `Sample plan. Add a thing.

## Open Questions

### Which option?

- [ ] Option A[^fn1]
- [ ] Option B
- [ ] ${FREE_TEXT_PLACEHOLDER}

[^fn1]:
    This option keeps the current behavior exactly as it is today, which is the
    safer default for most reviewers.
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

/**
 * A depth-2 heading's own text (footnote references excised, orphan `[^name]`
 * markers stripped, internal whitespace collapsed) — `""` for a bare heading
 * with no inline content, which is the one structural error this format
 * reports rather than skips. Built from the heading's own CHILDREN span, not
 * the heading node's own position: that starts at the `#` run, which would
 * pull the marker and its separating space into `sourceText`'s slice.
 */
const headingText = (content: string, heading: Heading): string => {
  const children = heading.children
  if (children.length === 0) return ""
  const first = children[0]!
  const last = children[children.length - 1]!
  if (!first.position || !last.position) return ""
  const synthetic = {
    type: "heading",
    children,
    position: { start: first.position.start, end: last.position.end },
  }
  return stripFootnoteMarkers(sourceText(content, synthetic)).replace(/\s+/g, " ").trim()
}

/** One `###` heading node under a questions section, with its raw body block nodes (up to the next heading of any level). */
interface QuestionBlock {
  readonly heading: Heading
  readonly body: readonly RootContent[]
}

/**
 * Splits the tree's top-level nodes after a `## ... Questions` heading (given
 * its own index into `tree.children`) into consecutive `###` blocks. Stops at
 * the next heading of depth 1 or 2, or the end of the document. A depth-3
 * heading with no children (a bare `###`) is still collected as a block, not
 * skipped as prose — `parseQuestionBlock` is the one place that turns it into
 * a finding.
 */
const splitQuestionBlocks = (tree: Root, sectionHeadingIndex: number): readonly QuestionBlock[] => {
  const blocks: QuestionBlock[] = []
  let i = sectionHeadingIndex + 1

  while (i < tree.children.length) {
    const node = tree.children[i]!
    if (node.type === "heading" && node.depth <= 2) break

    if (node.type !== "heading" || node.depth !== 3) {
      i += 1
      continue
    }

    const heading = node
    i += 1
    const body: RootContent[] = []
    while (i < tree.children.length && tree.children[i]!.type !== "heading") {
      body.push(tree.children[i]!)
      i += 1
    }
    blocks.push({ heading, body })
  }

  return blocks
}

/**
 * The first non-blank line of a question's body, verbatim (footnote markers
 * stripped, trimmed) — a short summary for editor tooling. Taken from the
 * first body block's OWN start line only, never the whole (possibly wrapped)
 * node's joined text: a multi-line paragraph's continuation lines are not
 * part of the summary. A `footnoteDefinition` block is skipped — it is never
 * the question's own text.
 */
const firstBodyLineText = (lines: readonly string[], body: readonly RootContent[]): string => {
  const node = body.find((n) => n.type !== "footnoteDefinition")
  if (!node?.position) return ""
  const lineIndex = toLspPosition(node.position.start).line
  return stripFootnoteMarkers((lines[lineIndex] ?? "").trim())
}

/**
 * Every task-list `listItem` in the TOP-LEVEL list(s) that appear directly in
 * a question's body, in document order — never nested sub-lists (a
 * continuation indented far enough to form a nested list under an option is
 * not itself an option). `listItem.checked` — set by the GFM task-list
 * extension — replaces the old checkbox regex entirely.
 *
 * Scope decision: a genuinely NESTED task-list item (indented under an
 * existing option, so CommonMark parses it as that option's own sub-list,
 * not indented code) is deliberately excluded from `options` — this format
 * has no notion of a sub-option. It is a real, correctly-recognized node, not
 * lost text, so `strictReadingFindings` (below) never flags it either; that
 * refusal exists only for a shape that the tree drops entirely.
 */
const optionListItems = (body: readonly RootContent[]): readonly ListItem[] => {
  const items: ListItem[] = []
  for (const node of body) {
    if (node.type !== "list") continue
    for (const child of (node as List).children) {
      if (child.checked !== null) items.push(child)
    }
  }
  return items
}

/**
 * The source OFFSET right after an option's `- [ ]`/`- [x]` marker — the
 * first inline child of the item's paragraph, NOT the paragraph node's own
 * position. `mdast-util-gfm-task-list-item` splices the consumed `[x] `
 * text node out of a CHECKED item's paragraph without re-deriving the
 * paragraph's own (now-stale) `position.start` when what's left starts with a
 * non-text inline node (an unfilled placeholder's emphasis, say) — the
 * paragraph's first CHILD is always positioned correctly, so this reads that
 * instead. `undefined` when the item has no paragraph, or an empty one (a
 * bare `- [ ]`/`- [x]` with no text).
 */
const optionContentOffset = (item: ListItem): number | undefined => {
  const paragraph = item.children.find((c) => c.type === "paragraph")
  return paragraph?.children[0]?.position?.start.offset
}

/**
 * An option's own text: everything after the `- [ ]`/`- [x]` marker on the
 * item's FIRST line only, never a wrapped continuation line — matching the
 * OLD per-line regex capture (`endLine` still spans the wrap; `text` never
 * did).
 */
const optionText = (content: string, lines: readonly string[], item: ListItem): string => {
  const offset = optionContentOffset(item)
  if (offset === undefined || !item.position) return ""
  const sourceLine = toLspPosition(item.position.start).line
  const startCharacter = toLspPositionFromOffset(content, offset).character
  const raw = (lines[sourceLine] ?? "").slice(startCharacter)
  return stripFootnoteMarkers(raw).trim()
}

/** Extracts the checkbox options from a question block's body, in document order. */
const parseOptions = (
  content: string,
  lines: readonly string[],
  body: readonly RootContent[],
): QuestionOption[] => {
  const items = optionListItems(body)
  const lastIndex = items.length - 1
  return items.map((item, i) => {
    const freeText = i === lastIndex
    const rawText = optionText(content, lines, item)
    const text = freeText && rawText.toLowerCase() === FREE_TEXT_PLACEHOLDER ? "" : rawText
    return {
      checked: item.checked === true,
      text,
      freeText,
      sourceLine: toLspPosition(item.position!.start).line,
      endLine: toLspPosition(item.position!.end).line,
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
  content: string,
  lines: readonly string[],
  block: QuestionBlock,
  status: OpenQuestionStatus,
): OpenQuestion | { readonly error: string } => {
  const question = headingText(content, block.heading)
  if (question.length === 0) {
    return {
      error:
        "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
    }
  }

  const headingLine = toLspPosition(block.heading.position!.start).line
  const text = firstBodyLineText(lines, block.body)
  const options = status === "open" ? parseOptions(content, lines, block.body) : []

  return {
    question,
    status,
    text,
    headingLine,
    options,
    answered: status === "open" && options.length > 0 && isAnswered(options),
  }
}

/**
 * `## Open Questions` must precede every other level-2 section, and
 * `## Answered Questions` must follow every other level-2 section — so a
 * reader (and a driver walking the file) always finds open questions first
 * and resolved ones last. At most one finding per rule, regardless of how
 * many competing sections offend it. Level-1 headings and prose don't count,
 * and — because this walks `heading` NODES, never a string search — a
 * `## Open Questions` line quoted inside a fenced code block (a `code` node,
 * not a heading) never counts as the section either.
 *
 * Known gap, out of this package's scope: a `## Open Questions` heading
 * itself indented 4+ spaces parses as indented code too, so the whole
 * section (and every question in it) goes unrecognized with no finding —
 * `strictReadingFindings` only covers the `### ` heading and `- [ ]` option
 * shapes this package's acceptance criteria name, not the section heading.
 */
const checkSectionOrder = (tree: Root, content: string): readonly string[] => {
  const h2 = tree.children.filter((n): n is Heading => n.type === "heading" && n.depth === 2)
  const openIndex = h2.findIndex((h) => headingText(content, h) === "Open Questions")
  const answeredIndex = h2.findIndex((h) => headingText(content, h) === "Answered Questions")

  const findings: string[] = []
  if (openIndex !== -1 && h2.some((_h, i) => i !== openIndex && i < openIndex)) {
    findings.push("A '##' section appears before '## Open Questions', which must come first")
  }
  if (answeredIndex !== -1 && h2.some((_h, i) => i !== answeredIndex && i > answeredIndex)) {
    findings.push("A '##' section appears after '## Answered Questions', which must come last")
  }
  return findings
}

/** A line shaped like a '### ' question heading, indented past what CommonMark still parses as a real heading — used only by `strictReadingFindings` to recognize what fell through. */
const HEADING_SHAPE_RE = /^#{3}(?:\s|$)/

/** A line shaped like a '- [ ]'/'- [x]'/'* [X]' task-list option, indented past what CommonMark still parses as a real list item — used only by `strictReadingFindings` to recognize what fell through. */
const OPTION_SHAPE_RE = /^[-*]\s*\[[ xX]\]/

/**
 * True when the `code` node at `node` is FENCED (```` ``` ````/`~~~`), never
 * indented — both parse to the same `code` node type, so telling them apart
 * means checking the delimiter that actually opens the block, back in the
 * source. A fenced block quoting `### ` or `- [ ]` text is a legitimate
 * example, not a dropped heading/option — `strictReadingFindings` must not
 * fire on it.
 */
const isFencedCode = (content: string, node: Code): boolean => {
  if (!node.position) return false
  const lines = content.split(/\r?\n/)
  const raw = (lines[toLspPosition(node.position.start).line] ?? "").trim()
  return raw.startsWith("```") || raw.startsWith("~~~")
}

/**
 * Every 0-based line inside a NODE matching `predicate`, at any nesting
 * depth — the general walk both `recognizedStructureLines` and
 * `fencedCodeLines` share, so `strictReadingFindings` can exclude a line for
 * either reason with the same logic.
 */
const linesWhere = (tree: Root, predicate: (node: RootContent) => boolean): Set<number> => {
  const lines = new Set<number>()
  const walk = (node: RootContent | Root): void => {
    if (node.type !== "root" && predicate(node) && node.position) {
      const start = toLspPosition(node.position.start).line
      const end = toLspPosition(node.position.end).line
      for (let l = start; l <= end; l += 1) lines.add(l)
    }
    const children = (node as { children?: readonly RootContent[] }).children
    if (children) children.forEach(walk)
  }
  walk(tree)
  return lines
}

/**
 * Every 0-based line already inside a REAL, recognized `heading` (any depth)
 * or task-list `listItem` (any nesting depth — a genuinely nested option,
 * which `optionListItems` deliberately excludes from `options` but which is
 * still a correctly-parsed node, not lost text) — `strictReadingFindings`
 * never flags these: they're legitimately part of the tree already, however
 * this format chooses to use (or not use) them.
 */
const recognizedStructureLines = (tree: Root): Set<number> =>
  linesWhere(tree, (n) => n.type === "heading" || (n.type === "listItem" && n.checked !== null))

/** Every 0-based line inside a FENCED code block — a legitimate quoted example, never a strict-reading violation (unlike an indented code block, or an indented lazy paragraph continuation, which the refusal exists to catch). */
const fencedCodeLines = (tree: Root, content: string): Set<number> =>
  linesWhere(tree, (n) => n.type === "code" && isFencedCode(content, n))

/**
 * A depth-2 section heading's own body line range: from just after the
 * heading's own line to (but excluding) the next depth-1/2 heading's line,
 * or the document's last line. Line-based (not node-index-based) because the
 * whole point of `strictReadingFindings` is to catch source that DIDN'T
 * become a distinct top-level node — a lazy paragraph continuation folds
 * into the PRECEDING paragraph's own node, so there is no node boundary to
 * walk between here.
 */
const sectionLineRange = (
  tree: Root,
  content: string,
  heading: Heading,
): { readonly start: number; readonly end: number } => {
  const lines = content.split(/\r?\n/)
  const index = tree.children.indexOf(heading)
  const start = toLspPosition(heading.position!.end).line + 1
  let end = lines.length - 1
  for (let i = index + 1; i < tree.children.length; i += 1) {
    const node = tree.children[i]!
    if (node.type === "heading" && node.depth <= 2 && node.position) {
      end = toLspPosition(node.position.start).line - 1
      break
    }
  }
  return { start, end }
}

/**
 * The strict reading's positioned refusal: a `### `-shaped or `- [ ]`-shaped
 * line indented 4+ spaces is never a real heading or list item — either
 * INDENTED CODE (when it opens its own block) or, just as easily, a LAZY
 * PARAGRAPH CONTINUATION of whatever non-blank line precedes it (when it
 * doesn't) — so without this check it vanishes with no signal at all: a
 * whole question silently dropped, or left with zero options and read as
 * merely unanswered. Scans every RAW line of a `## Open Questions`/
 * `## Answered Questions` section's own body for such a line (excluding
 * lines already inside a real heading/list-item node, or inside a fenced
 * code block) and reports it at that EXACT source line, rather than let it
 * disappear regardless of which of the two swallowed it.
 */
const strictReadingFindings = (tree: Root, content: string): SteeringFinding[] => {
  const findings: SteeringFinding[] = []
  const lines = content.split(/\r?\n/)
  const skip = recognizedStructureLines(tree)
  const fenced = fencedCodeLines(tree, content)

  for (const sectionName of ["Open Questions", "Answered Questions"]) {
    const heading = tree.children.find(
      (n): n is Heading =>
        n.type === "heading" && n.depth === 2 && headingText(content, n) === sectionName,
    )
    if (!heading?.position) continue
    const { start, end } = sectionLineRange(tree, content, heading)

    for (let line = start; line <= end; line += 1) {
      if (skip.has(line) || fenced.has(line)) continue
      const raw = lines[line] ?? ""
      if (raw.length - raw.trimStart().length < 4) continue
      const trimmed = raw.trim()
      if (HEADING_SHAPE_RE.test(trimmed)) {
        findings.push({
          message: `An indented (4+ space) "${trimmed}" is markdown indented code (or a lazy paragraph continuation), not a question heading — it is silently dropped otherwise`,
          line,
        })
      } else if (OPTION_SHAPE_RE.test(trimmed)) {
        findings.push({
          message: `An indented (4+ space) "${trimmed}" is markdown indented code (or a lazy paragraph continuation), not an option — it is silently dropped otherwise`,
          line,
        })
      }
    }
  }
  return findings
}

/**
 * Parses the open-questions structure out of `content`, plus every finding
 * `QA_FORMAT.validate` reports — each carrying a `line` when the underlying
 * violation is positioned (currently only `strictReadingFindings`'s; section-
 * order and empty-heading findings stay positionless, as before). Shared by
 * `parseOpenQuestions` (the `errors: string[]` compatibility shape) and
 * `QA_FORMAT.validate` (which needs each finding's `line`), so the two can
 * never drift apart — mirrors `ReviewDoc.ts`'s `parseReviewFindings`.
 */
const parseOpenQuestionsFindings = (
  content: string,
): {
  readonly questions: readonly OpenQuestion[]
  readonly findings: readonly SteeringFinding[]
} => {
  const tree = parseMarkdown(content)
  const lines = content.split(/\r?\n/)

  const questions: OpenQuestion[] = []
  const findings: SteeringFinding[] = [
    ...checkSectionOrder(tree, content).map((message) => ({ message })),
    ...strictReadingFindings(tree, content),
  ]

  const sections: readonly (readonly [string, OpenQuestionStatus])[] = [
    ["Open Questions", "open"],
    ["Answered Questions", "answered"],
  ]

  for (const [sectionName, status] of sections) {
    const headingNode = tree.children.find(
      (n): n is Heading =>
        n.type === "heading" && n.depth === 2 && headingText(content, n) === sectionName,
    )
    if (!headingNode) continue
    const index = tree.children.indexOf(headingNode)
    for (const block of splitQuestionBlocks(tree, index)) {
      const result = parseQuestionBlock(content, lines, block, status)
      if ("error" in result) {
        findings.push({ message: result.error })
      } else {
        questions.push(result)
      }
    }
  }

  questions.sort((a, b) => a.headingLine - b.headingLine)
  return { questions, findings }
}

/**
 * Parses the open-questions structure out of `content`. Total and
 * side-effect-free: always returns a result, never throws. Questions are
 * returned in document order (by heading line). `errors` drops each
 * finding's `line` (see `parseOpenQuestionsFindings`, which `QA_FORMAT.validate`
 * uses instead) — kept as plain messages for this function's own callers.
 */
export const parseOpenQuestions = (content: string): OpenQuestionsDoc => {
  const { questions, findings } = parseOpenQuestionsFindings(content)
  return { questions, errors: findings.map((f) => f.message) }
}

/** Every OPEN question that is not answered — the answer-completeness guard (`src/StepGuards.ts`) refuses a step while this is non-empty. */
export const unansweredQuestions = (content: string): readonly OpenQuestion[] =>
  parseOpenQuestions(content).questions.filter((q) => q.status === "open" && !q.answered)

/**
 * Flips the checkbox on the task-list item starting at `line`, preserving the
 * rest of the line exactly. `undefined` when `line` isn't a real task-list
 * item's own start line — a bare `[x]` in ordinary prose doesn't count,
 * because it never parses into a `listItem` with `checked !== null` at all.
 *
 * The box's offset is resolved as the first `[` at or after the item's own
 * start offset, bounded by (before) its content's start offset
 * (`optionContentOffset`) — the task-list extension consumes the `[x]`
 * marker, so the item's actual text starts right after `] `, and that window
 * contains only the list marker and the box. This replaces a guess
 * (`raw.indexOf("[")` over the whole line, which text containing its own `[`
 * could otherwise mislead) with an exact offset that cannot land on anything
 * but the box.
 */
export const toggleCheckbox = (content: string, line: number): SteeringEdit | undefined => {
  const tree = parseMarkdown(content)
  const item = taskItems(tree).find((it) => toLspPosition(it.position!.start).line === line)
  if (!item?.position) return undefined

  const startOffset = item.position.start.offset!
  const boundOffset = optionContentOffset(item) ?? item.position.end.offset!
  const bracketOffset = content.indexOf("[", startOffset)
  if (bracketOffset === -1 || bracketOffset >= boundOffset) return undefined

  const position = toLspPositionFromOffset(content, bracketOffset)
  const character = position.character + 1
  return {
    range: {
      start: { line: position.line, character },
      end: { line: position.line, character: character + 1 },
    },
    newText: item.checked === true ? " " : "x",
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

/** One footnote marker rendered as an outline leaf: `[^name] <body>`. */
const footnoteLeaf = (
  lines: readonly string[],
  definitionByName: ReadonlyMap<string, string>,
  marker: FootnoteMarker,
): SteeringOutlineNode => ({
  name: `[^${marker.name}] ${definitionByName.get(marker.name) ?? ""}`.trim(),
  range: lineRange(lines, marker.line),
  selectionRange: lineRange(lines, marker.line),
  leaf: true,
})

/**
 * The outline tree for a `qa`-mode file's open/answered questions, each
 * option a `leaf: true` child of its open question — unless it carries a
 * footnote of its own, in which case it's a container instead (`leaf` and
 * `children` are never both set; see `SteeringFormat.ts`'s `leaf` doc). A
 * footnote is itself always a `leaf: true` child of whichever node's span
 * contains its marker — an option when the marker sits inside that option's
 * span, otherwise the question itself.
 */
const questionsOutline = (content: string): readonly SteeringOutlineNode[] => {
  const { questions } = parseOpenQuestions(content)
  const { markers, definitions } = parseFootnotes(content)
  const definitionByName = new Map(definitions.map((d) => [d.name, d.body]))
  const lines = content.split(/\r?\n/)
  return questions.map((question, i) => {
    const start = question.headingLine
    const end = Math.max(start, (questions[i + 1]?.headingLine ?? lines.length) - 1)
    const questionMarkers = markers.filter((m) => m.line >= start && m.line <= end)
    const assigned = new Set<FootnoteMarker>()

    const optionChildren: SteeringOutlineNode[] = question.options.map((option) => {
      const optionMarkers = questionMarkers.filter(
        (m) => m.line >= option.sourceLine && m.line <= option.endLine,
      )
      optionMarkers.forEach((m) => assigned.add(m))
      const footnotes = optionMarkers.map((m) => footnoteLeaf(lines, definitionByName, m))
      return {
        name: `${option.checked ? "[x]" : "[ ]"} ${option.text || "your answer"}`,
        range: spanRange(lines, option.sourceLine, option.endLine),
        selectionRange: lineRange(lines, option.sourceLine),
        // `leaf: true` means "no children of its own" (SteeringFormat.ts) —
        // an option with a footnote child is no longer one, matching
        // ReviewDoc.ts's chunk nodes (children, no `leaf`).
        ...(footnotes.length > 0 ? { children: footnotes } : { leaf: true }),
      }
    })

    const questionFootnotes = questionMarkers
      .filter((m) => !assigned.has(m))
      .map((m) => footnoteLeaf(lines, definitionByName, m))
    const children = [...optionChildren, ...questionFootnotes]

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
 * The block a footnote lands after when "add a footnote" fires with the
 * cursor at `cursorLine`: the whole contiguous option list's own span (its
 * first option's `sourceLine` through its last option's `endLine`, never
 * split between two items) when the cursor sits inside one; otherwise the
 * containing top-level block NODE's own end line (`blockNodeAt`) — covers
 * question-body prose ABOVE a list, a question with no options at all, and
 * any cursor position outside every question. Falls back to `cursorLine`
 * itself only past the end of the document, where no block node exists.
 */
const footnoteBlockEnd = (content: string, tree: Root, cursorLine: number): number => {
  const { questions } = parseOpenQuestions(content)
  for (const question of questions) {
    if (question.options.length === 0) continue
    const first = question.options[0]!.sourceLine
    const last = question.options[question.options.length - 1]!.endLine
    if (cursorLine >= first && cursorLine <= last) return last
  }
  const block = blockNodeAt(tree, cursorLine)
  return block?.position ? toLspPosition(block.position.end).line : cursorLine
}

/**
 * Actions for a `qa`-mode file: anywhere on an open question's option's list
 * item, "pick this option" (radio semantics) or "uncheck this option" when
 * it's already chosen; "add a footnote" everywhere EXCEPT inside an existing
 * marker's span or on an existing definition's own line — planting a new
 * marker/definition there would corrupt the footnote already written. No
 * pick/uncheck action off an option's span, or on an answered-section
 * (prose) question.
 */
const questionActions: SteeringFormat["actions"] = (content, range) => {
  const { questions } = parseOpenQuestions(content)
  const tree = parseMarkdown(content)
  const cursorLine = range.start.line
  const actions: Array<{ readonly title: string; readonly edits: readonly SteeringEdit[] }> = []
  if (!isOnExistingFootnote(content, range.start)) {
    actions.push({
      title: "gtd: add a footnote",
      edits: footnoteAdditionEdits(
        content,
        range.start,
        footnoteBlockEnd(content, tree, cursorLine),
      ),
    })
  }
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

/**
 * `qa`'s `pointerAt`: footnote jumps only (an open question's options have
 * nothing else to jump to) — marker → definition, definition → first marker,
 * both within the same document.
 */
const questionsPointerAt: SteeringFormat["pointerAt"] = (content, position) =>
  footnotePointerAt(content, position)?.pointer

/** The `qa` steering format: gtd's own in-process open-questions checkbox format — validation, outline, code actions, and a footnote-only `pointerAt`. Most structural findings are positionless, but the strict-reading refusal and a footnote finding both carry the offending line. */
export const QA_FORMAT: SteeringFormat = {
  sample: QA_SAMPLE,
  validate: (content) => [
    ...parseOpenQuestionsFindings(content).findings,
    ...parseFootnotes(content).findings,
  ],
  outline: questionsOutline,
  actions: questionActions,
  pointerAt: questionsPointerAt,
}
