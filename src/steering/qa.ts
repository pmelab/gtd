import type { Code, Heading, List, ListItem, Root, RootContent } from "mdast"
import { blockNodesOf, blockNodesOfRun, blockRunInline } from "./Blocks.js"
import type { Footnotes, FootnoteAnchor, FootnoteMarker } from "./Footnotes.js"
import { collapseImages, type InlineNode } from "./Inline.js"
import {
  FOOTNOTE_ACTION_TITLE,
  footnoteAdditionEdits,
  footnoteAttachEdits,
  footnotePointerAt,
  isOnExistingFootnote,
  parseFootnotes,
} from "./Footnotes.js"
import {
  blockEndLine,
  blockNodeAt,
  footnoteLeaf,
  headingText as sharedHeadingText,
  lineRange,
  parseMarkdown,
  spanRange,
  taskItems,
  toLspPosition,
  toLspPositionFromOffset,
  type HeadingBlock,
} from "./MarkdownTree.js"
import type {
  SteeringAnchor,
  SteeringAnnotateResult,
  SteeringEdit,
  SteeringFinding,
  SteeringFormat,
  SteeringOutlineNode,
  SteeringView,
  SteeringViewNode,
} from "./SteeringFormat.js"

type OpenQuestionStatus = "open" | "answered"

/**
 * A marker as plain text. Local to this module because `headingText`/
 * `optionText` extract text that is NOT a full node's tree span, which
 * `sourceText`'s own reference exclusion does not cover.
 */
const MARKER_TEXT_RE = /\[\^([^\s\]]+)\]/g

/** Strips every `[^name]`-shaped marker out of already-extracted `text` — see `MARKER_TEXT_RE`. */
const stripMarkerText = (text: string): string => text.replace(MARKER_TEXT_RE, "")

/**
 * The sentinel an UNFILLED free-text option carries — the human answers by
 * REPLACING it with their own text and ticking that line. The parser
 * normalizes a last-option text equal to this to `""`, so a ticked-but-
 * unfilled free-text option reads as unanswered (see `OpenQuestion.answered`).
 */
export const FREE_TEXT_PLACEHOLDER = "_your answer_"

/**
 * The canonical sample. Every detail is load-bearing: the three real options
 * carry nested impact lists of DIFFERENT bullet counts, so the parser,
 * outline and view tests cover more than one shape at once; both footnote
 * bodies exceed 80 characters so the formatter round-trip actually reflows
 * one; Option B's is `na`-prefixed (server-attached, not hand-authored) and
 * carries a multi-word inline code span; and the whole document is already an
 * oxfmt fixed point.
 */
const QA_SAMPLE = `Sample plan. Add a thing.

## Open Questions

### Which option?

- [ ] Option A[^fn1]
  - Keeps today's behavior exactly as it is
- [ ] Option B[^na17v2bjb]
  - Costs a migration script
  - Buys a smaller runtime footprint
- [ ] Option C
  - Splits the difference between A and B
  - Costs the most review time
  - Buys the easiest rollback

[^na17v2bjb]:
    Attached via the phone UI on Option B, this note carries a
    \`multi word code span\` and exceeds eighty characters in length so it gets
    wrapped.

- [ ] ${FREE_TEXT_PLACEHOLDER}

[^fn1]:
    This option keeps the current behavior exactly as it is today, which is the
    safer default for most reviewers.
`

/** One checkbox option under an OPEN question: its ticked state, its text (the free-text placeholder normalized to `""`), and its source line span for editor tooling. */
interface QuestionOption {
  readonly checked: boolean
  /** Text after the `- [ ]`/`- [x]` marker, trimmed. The unfilled free-text placeholder (`FREE_TEXT_PLACEHOLDER`) normalizes to `""`. */
  readonly text: string
  /** `true` for the LAST option of the block — the free-text "your answer" slot (identified positionally, not by label). */
  readonly freeText: boolean
  readonly sourceLine: number
  /** 0-based line index of the LAST line of this option's list item — equal to `sourceLine` unless the item's text wraps onto continuation lines. */
  readonly endLine: number
  /**
   * This option's own nested blocks — a nested plain bullet list or a second
   * paragraph under it, projected through the shared block walk
   * (`optionBodyNodes`). `[]` when the option carries none. Never part of
   * `text`, and never reached by the write-back span (`optionTextSpan`) —
   * see that span's own doc comment for why it stays narrow.
   */
  readonly body: readonly SteeringViewNode[]
}

interface OpenQuestion {
  readonly question: string
  readonly status: OpenQuestionStatus
  /** The whole body's collapsed text (every `bodyNodes` block's own title, joined), or `""` for a question with no body — feeds the phone view's `detail`, the question card, and the LSP outline's own `detail` alike. */
  readonly text: string
  /** The question's own body run, projected through the shared block walk (`questionBodyNodes`) — every body block EXCEPT the option list itself, in document order. `[]` for a question with no body. */
  readonly bodyNodes: readonly SteeringViewNode[]
  /** `text`'s own inline counterpart, image-collapsed (R2) — feeds the question node's `detailInline`. Built over the SAME body run and `skipListItem` option as `bodyNodes`/`text`. */
  readonly bodyInline: readonly InlineNode[]
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

interface OpenQuestionsDoc {
  readonly questions: readonly OpenQuestion[]
  readonly findings: readonly SteeringFinding[]
}

/**
 * `qa`'s own `headingText`: the shared mdast helper (`MarkdownTree.ts`), with
 * `qa`'s extra pass of orphan `[^name]`-marker stripping — the one thing
 * `qa` needs beyond the shared footnote-reference exclusion every format
 * gets for free.
 */
const headingText = (content: string, heading: Heading): string =>
  sharedHeadingText(content, heading, stripMarkerText)

/** One `###` heading node under a questions section, with its raw body block nodes (up to the next heading of any level). */
interface QuestionBlock extends HeadingBlock {}

/** Splits the nodes after a `## ... Questions` heading into consecutive `###` blocks. A bare `###` with no children is still collected — `parseQuestionBlock` is the one place that turns it into a finding. */
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
 * Every task-list `listItem` in the TOP-LEVEL lists of a question's body, in
 * document order. A NESTED task-list item is deliberately not an option —
 * this format has no sub-option — and `recognizedStructureLines` does NOT
 * shield it from `strictReadingFindings`, so a 4+-space nested option gets a
 * positioned finding rather than silently vanishing.
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
 * A question's body run through the shared block walk, with the question's
 * own option ITEMS excluded by node identity — never a whole list swept out
 * because some of its children are options, so a plain bullet sharing a list
 * with real options still surfaces in `body`. `footnotes` is
 * `parseOpenQuestions`'s SINGLE `parseFootnotes` call, threaded in: a
 * re-parse here would be a whole-document walk per question and per option.
 */
const questionBodyNodes = (
  content: string,
  body: readonly RootContent[],
  footnotes: Footnotes,
): readonly SteeringViewNode[] => {
  const optionItems = new Set(optionListItems(body))
  return blockNodesOfRun(content, body, {
    skipListItem: (item) => optionItems.has(item),
    footnotes,
  })
}

/** `questionBodyNodes`'s own inline counterpart — the SAME body run and `skipListItem` option, walked by `Blocks.ts#blockRunInline` instead, then image-collapsed (R2) for the question node's `detailInline`. */
const questionBodyInline = (
  content: string,
  body: readonly RootContent[],
): readonly InlineNode[] => {
  const optionItems = new Set(optionListItems(body))
  return collapseImages(
    blockRunInline(content, body, { skipListItem: (item) => optionItems.has(item) }),
  )
}

/** The whole body's collapsed text — every `bodyNodes` block's own title, joined with a single space, or `""` for an empty body. Feeds `OpenQuestion.text`. */
const bodyText = (bodyNodes: readonly SteeringViewNode[]): string =>
  bodyNodes
    .map((node) => node.title)
    .filter((title) => title.length > 0)
    .join(" ")

/**
 * The source offset right after an option's `- [ ]`/`- [x]` marker, read off
 * the first inline CHILD rather than the paragraph node:
 * `mdast-util-gfm-task-list-item` leaves a checked item's paragraph with a
 * stale `position.start` when what remains starts with a non-text inline node.
 */
const optionContentOffset = (item: ListItem): number | undefined => {
  const paragraph = item.children.find((c) => c.type === "paragraph")
  return paragraph?.children[0]?.position?.start.offset
}

/**
 * The ONE span an option's text is read from and written back over: after the
 * marker through the end of the item's FIRST PARAGRAPH, never the list item's
 * end. A wrapped option is one paragraph, so the wrap is covered; a nested
 * list, second paragraph or footnote definition sits outside it and a
 * free-text save can never delete it. Both the reader and the writer call
 * this, so the two can never drift into that corruption.
 */
const optionTextSpan = (
  item: ListItem,
): { readonly start: number; readonly end: number } | undefined => {
  const start = optionContentOffset(item)
  const paragraph = item.children.find((c) => c.type === "paragraph")
  const end = paragraph?.position?.end.offset
  if (start === undefined || end === undefined) return undefined
  return { start, end }
}

/**
 * An option's own text: the WHOLE `optionTextSpan`, marker-stripped and
 * whitespace-collapsed — a wrapped option's continuation lines are part of
 * this, unlike the old per-line-only capture. `""` when the option has no
 * paragraph at all (a bare `- [ ]`).
 */
const optionText = (content: string, item: ListItem): string => {
  const span = optionTextSpan(item)
  if (!span) return ""
  return stripMarkerText(content.slice(span.start, span.end)).replace(/\s+/g, " ").trim()
}

/**
 * An option's own nested blocks — the list item's children with its label
 * paragraph (the one `optionTextSpan`/`optionText` already read) excluded,
 * run through the shared block walk (`Blocks.ts#blockNodesOfRun`). A nested
 * plain bullet list under an option is real per-option content (`checked` is
 * `null` on a plain bullet, exactly what `optionListItems` already filters
 * on, so it can never be mistaken for a sub-option); a second paragraph under
 * the option reads the same way. `[]` for an option with nothing nested under
 * it. `footnotes` is `parseOpenQuestions`'s own SINGLE `parseFootnotes` call,
 * threaded in rather than re-parsed here: `blockNodesOfRun`'s own footnote
 * pass walks the WHOLE document, so a question with five options re-parsing
 * it five times over (on top of the per-question pass `questionBodyNodes`
 * already pays) would cost work proportional to the file, not to the
 * option's own nested nodes.
 */
const optionBodyNodes = (
  content: string,
  item: ListItem,
  footnotes: Footnotes,
): readonly SteeringViewNode[] => {
  const labelParagraph = item.children.find((c) => c.type === "paragraph")
  const rest = item.children.filter((c) => c !== labelParagraph)
  return blockNodesOfRun(content, rest, { footnotes })
}

/** Extracts the checkbox options from a question block's body, in document order. */
const parseOptions = (
  content: string,
  body: readonly RootContent[],
  footnotes: Footnotes,
): QuestionOption[] => {
  const items = optionListItems(body)
  const lastIndex = items.length - 1
  return items.map((item, i) => {
    const freeText = i === lastIndex
    const rawText = optionText(content, item)
    // `.toLowerCase()` on BOTH sides — never assume `FREE_TEXT_PLACEHOLDER`
    // itself is already lowercase, mirroring `Question.tsx`'s identical
    // client-side comparison exactly, so the two can never silently diverge
    // if the constant's own casing ever changes.
    const text =
      freeText && rawText.toLowerCase() === FREE_TEXT_PLACEHOLDER.toLowerCase() ? "" : rawText
    return {
      checked: item.checked === true,
      text,
      freeText,
      sourceLine: toLspPosition(item.position!.start).line,
      endLine: toLspPosition(item.position!.end).line,
      body: optionBodyNodes(content, item, footnotes),
    }
  })
}

/** The three fields `isAnswered` reads, narrower than `QuestionOption` so a CLIENT can build this from its own radio state and call the identical predicate. */
export interface AnsweredOption {
  readonly checked: boolean
  readonly text: string
  readonly freeText: boolean
}

/**
 * An OPEN question is answered iff EXACTLY ONE option is ticked and, for the
 * free-text slot, its normalized text is non-empty. Zero ticks, two+ ticks and
 * a ticked-but-empty slot all read as not answered. The phone client calls
 * this same function rather than recomputing the rule.
 */
export const isAnswered = (options: readonly AnsweredOption[]): boolean => {
  const ticked = options.filter((o) => o.checked)
  if (ticked.length !== 1) return false
  const chosen = ticked[0]!
  return !(chosen.freeText && chosen.text.length === 0)
}

/** A heading node's own span (the `#` run through its own line's end) as a `SteeringFinding.range` — the NODE a heading-shaped finding is about. */
const headingRange = (heading: Heading) => ({
  start: toLspPosition(heading.position!.start),
  end: toLspPosition(heading.position!.end),
})

const parseQuestionBlock = (
  content: string,
  block: QuestionBlock,
  status: OpenQuestionStatus,
  footnotes: Footnotes,
): OpenQuestion | { readonly error: SteeringFinding } => {
  const question = headingText(content, block.heading)
  if (question.length === 0) {
    return {
      error: {
        message:
          "An '### ' question heading under '## Open Questions' or '## Answered Questions' has no question text",
        line: toLspPosition(block.heading.position!.start).line,
        range: headingRange(block.heading),
      },
    }
  }

  const headingLine = toLspPosition(block.heading.position!.start).line
  const bodyNodes = questionBodyNodes(content, block.body, footnotes)
  const bodyInline = questionBodyInline(content, block.body)
  const options = status === "open" ? parseOptions(content, block.body, footnotes) : []

  return {
    question,
    status,
    text: bodyText(bodyNodes),
    bodyNodes,
    bodyInline,
    headingLine,
    options,
    answered: status === "open" && options.length > 0 && isAnswered(options),
  }
}

/**
 * `## Open Questions` first, `## Answered Questions` last, so a reader always
 * finds open questions before resolved ones. At most one finding per rule.
 * Walks `heading` NODES, never a string search, so the line quoted inside a
 * fenced code block never counts as the section.
 *
 * Known gap: a `## Open Questions` heading itself indented 4+ spaces parses as
 * indented code, so the whole section goes unrecognized with no finding —
 * `strictReadingFindings` covers the `### ` and `- [ ]` shapes, not this one.
 */
const checkSectionOrder = (tree: Root, content: string): readonly SteeringFinding[] => {
  const h2 = tree.children.filter((n): n is Heading => n.type === "heading" && n.depth === 2)
  const openIndex = h2.findIndex((h) => headingText(content, h) === "Open Questions")
  const answeredIndex = h2.findIndex((h) => headingText(content, h) === "Answered Questions")

  const findings: SteeringFinding[] = []
  // `openIndex > 0` — a section exists BEFORE it — is the whole condition;
  // `i !== openIndex` was always true whenever `i < openIndex` already held,
  // so it added nothing (a guaranteed-surviving mutant on the dead clause).
  if (openIndex > 0) {
    const offender = h2[0]!
    findings.push({
      message: "A '##' section appears before '## Open Questions', which must come first",
      line: toLspPosition(offender.position!.start).line,
      range: headingRange(offender),
    })
  }
  // Same simplification: `answeredIndex < h2.length - 1` — a section exists
  // AFTER it — is the whole condition.
  if (answeredIndex !== -1 && answeredIndex < h2.length - 1) {
    const offender = h2[h2.length - 1]!
    findings.push({
      message: "A '##' section appears after '## Answered Questions', which must come last",
      line: toLspPosition(offender.position!.start).line,
      range: headingRange(offender),
    })
  }
  return findings
}

/** A line shaped like a '### ' question heading, indented past what CommonMark still parses as a real heading — used only by `strictReadingFindings` to recognize what fell through. */
const HEADING_SHAPE_RE = /^#{3}(?:\s|$)/

/** A line shaped like a '- [ ]'/'- [x]'/'* [X]' task-list option, indented past what CommonMark still parses as a real list item — used only by `strictReadingFindings` to recognize what fell through. */
const OPTION_SHAPE_RE = /^[-*]\s*\[[ xX]\]/

/** FENCED, never indented — both parse to the same `code` node, so telling them apart means reading the opening delimiter back out of the source. A fenced block quoting `### ` is an example, not a dropped heading. */
const isFencedCode = (content: string, node: Code): boolean => {
  if (!node.position) return false
  const lines = content.split(/\r?\n/)
  const raw = (lines[toLspPosition(node.position.start).line] ?? "").trim()
  return raw.startsWith("```") || raw.startsWith("~~~")
}

/**
 * Every 0-based line inside a NODE matching `predicate`, at any nesting
 * depth — used by `fencedCodeLines` (a fenced block is a legitimate quoted
 * example regardless of how deep it's nested).
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

const markRange = (lines: Set<number>, node: RootContent): void => {
  if (!node.position) return
  const start = toLspPosition(node.position.start).line
  const end = toLspPosition(node.position.end).line
  for (let l = start; l <= end; l += 1) lines.add(l)
}

/** Lines inside a NESTED `heading`/`list` under a top-level item. Real tree structure, but lost from this format's OUTPUT, so `recognizedStructureLines` must not excuse it just for sitting inside a real item's span. */
const nestedBlockLines = (item: ListItem): Set<number> => {
  const lines = new Set<number>()
  const walk = (node: RootContent): void => {
    if (node.type === "heading" || node.type === "list") {
      markRange(lines, node)
      return
    }
    const children = (node as { children?: readonly RootContent[] }).children
    if (children) children.forEach(walk)
  }
  item.children.forEach(walk)
  return lines
}

/** Marks a top-level `list` node's own TOP-LEVEL task-list items into `lines`, each minus its own `nestedBlockLines` — split out of `recognizedStructureLines` to keep that function's own complexity down. */
const markTopLevelListItems = (lines: Set<number>, list: List): void => {
  for (const item of list.children) {
    if (item.checked === null) continue
    markRange(lines, item)
    for (const nested of nestedBlockLines(item)) lines.delete(nested)
  }
}

/**
 * The lines `strictReadingFindings` never flags: a TOP-LEVEL depth-2/3
 * heading, a TOP-LEVEL task-list item's span MINUS any `heading`/`list`
 * nested inside it, and a `footnoteDefinition`'s whole span.
 *
 * Deeper nesting is deliberately NOT excluded, however validly CommonMark
 * parses it: `optionListItems` never looks past the top level, so that
 * content is as lost from this format's output as an unindented line.
 *
 * A footnote definition differs in kind, not degree — the human's free-text
 * channel, never a candidate heading or option under any reading — so its
 * whole span is excluded at any nesting. This repo's own footnote style
 * indents continuation lines four spaces, exactly the misfire threshold.
 */
const recognizedStructureLines = (tree: Root): Set<number> => {
  const lines = new Set<number>()
  for (const node of tree.children) {
    if (node.type === "heading" && (node.depth === 2 || node.depth === 3)) markRange(lines, node)
    if (node.type === "list") markTopLevelListItems(lines, node)
    if (node.type === "footnoteDefinition") markRange(lines, node)
  }
  return lines
}

/** Every 0-based line inside a FENCED code block — a legitimate quoted example, never a strict-reading violation (unlike an indented code block, or an indented lazy paragraph continuation, which the refusal exists to catch). */
const fencedCodeLines = (tree: Root, content: string): Set<number> =>
  linesWhere(tree, (n) => n.type === "code" && isFencedCode(content, n))

/** A depth-2 section's body line range. Line-based, not node-based: the point is to catch source that never became a distinct node, so there is no node boundary to walk. */
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

/** The strict-reading message for one dropped `trimmed` line, or `undefined` when it matches neither shape — split out of `strictReadingFindings` to keep that function's own complexity down. */
const strictReadingMessage = (trimmed: string): string | undefined => {
  if (HEADING_SHAPE_RE.test(trimmed)) {
    return `An indented (4+ space) "${trimmed}" is markdown indented code (or a lazy paragraph continuation), not a question heading — it is silently dropped otherwise`
  }
  if (OPTION_SHAPE_RE.test(trimmed)) {
    return `An indented (4+ space) "${trimmed}" is markdown indented code (or a lazy paragraph continuation), not an option — it is silently dropped otherwise`
  }
  return undefined
}

/** Every strict-reading finding in ONE section's own `[start, end]` line range — split out of `strictReadingFindings` to keep that function's own complexity down (one section's scan, not the loop over both sections). */
const strictReadingFindingsInRange = (
  lines: readonly string[],
  excluded: ReadonlySet<number>,
  start: number,
  end: number,
): SteeringFinding[] => {
  const findings: SteeringFinding[] = []
  for (let line = start; line <= end; line += 1) {
    if (excluded.has(line)) continue
    const raw = lines[line] ?? ""
    if (raw.length - raw.trimStart().length < 4) continue
    const message = strictReadingMessage(raw.trim())
    // No real node exists for this line (that's the whole violation — the
    // content never became one) so its range is the raw line itself, start
    // to end, rather than a node span.
    if (message) {
      findings.push({
        message,
        line,
        range: { start: { line, character: 0 }, end: { line, character: raw.length } },
      })
    }
  }
  return findings
}

/**
 * A `### `- or `- [ ]`-shaped line indented 4+ spaces is never a real heading
 * or list item — it is indented code, or a lazy paragraph continuation — so
 * without this it vanishes with no signal: a whole question silently dropped,
 * or one left with zero options and read as merely unanswered. Reported at the
 * exact source line, whichever of the two swallowed it.
 */
const strictReadingFindings = (tree: Root, content: string): SteeringFinding[] => {
  const lines = content.split(/\r?\n/)
  const excluded = new Set([...recognizedStructureLines(tree), ...fencedCodeLines(tree, content)])

  return ["Open Questions", "Answered Questions"].flatMap((sectionName) => {
    const heading = tree.children.find(
      (n): n is Heading =>
        n.type === "heading" && n.depth === 2 && headingText(content, n) === sectionName,
    )
    if (!heading?.position) return []
    const { start, end } = sectionLineRange(tree, content, heading)
    return strictReadingFindingsInRange(lines, excluded, start, end)
  })
}

/**
 * The structure plus every finding `validate` reports. Each finding carries a
 * `line` AND a `range` spanning its node — except `strictReadingFindings`',
 * which never had a node, so their range spans the raw offending line.
 *
 * `parseFootnotes(content)` runs exactly ONCE here and is threaded through
 * every question/option body walk below: re-running it per question or per
 * option would multiply a document-sized walk by every one in the file.
 */
export const parseOpenQuestions = (content: string): OpenQuestionsDoc => {
  const tree = parseMarkdown(content)
  const footnotes = parseFootnotes(content)

  const questions: OpenQuestion[] = []
  const findings: SteeringFinding[] = [
    ...checkSectionOrder(tree, content),
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
      const result = parseQuestionBlock(content, block, status, footnotes)
      if ("error" in result) {
        findings.push(result.error)
      } else {
        questions.push(result)
      }
    }
  }

  questions.sort((a, b) => a.headingLine - b.headingLine)
  return { questions, findings }
}

/** Every OPEN question that is not answered — what a flow's `openQuestions()` reads. */
const unansweredQuestions = (content: string): readonly OpenQuestion[] =>
  parseOpenQuestions(content).questions.filter((q) => q.status === "open" && !q.answered)

/**
 * Flips the checkbox on the task-list item at `line`, preserving the rest
 * exactly. The box is found in the window between the item's start offset and
 * its content offset — which holds only the list marker and the box — rather
 * than by `indexOf("[")`, which text containing its own `[` would mislead.
 */
const toggleCheckbox = (content: string, line: number): SteeringEdit | undefined => {
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

/** The outline marker for one question — `[unanswered]` entries are exactly the questions still blocking the answer-completeness gate. */
const statusMarker = (question: OpenQuestion): string => {
  if (question.status === "answered") return "[answered]"
  return question.answered ? "[answered]" : "[unanswered]"
}

/** Every question/answered heading's own line → its outline range's real end line (`blockEndLine`), across both sections — the node-boundary replacement for the old "next sibling's heading minus one" guess. */
const questionEndLines = (content: string): ReadonlyMap<number, number> => {
  const tree = parseMarkdown(content)
  const map = new Map<number, number>()
  for (const sectionName of ["Open Questions", "Answered Questions"]) {
    const headingNode = tree.children.find(
      (n): n is Heading =>
        n.type === "heading" && n.depth === 2 && headingText(content, n) === sectionName,
    )
    if (!headingNode) continue
    const index = tree.children.indexOf(headingNode)
    for (const block of splitQuestionBlocks(tree, index)) {
      map.set(toLspPosition(block.heading.position!.start).line, blockEndLine(block))
    }
  }
  return map
}

/** The outline tree. An option is a `leaf` unless it carries a footnote, which makes it a container instead — `leaf` and `children` are never both set. */
const questionsOutline = (content: string): readonly SteeringOutlineNode[] => {
  const { questions } = parseOpenQuestions(content)
  const { markers, definitions } = parseFootnotes(content)
  const definitionByName = new Map(definitions.map((d) => [d.name, d.body]))
  const lines = content.split(/\r?\n/)
  const endLines = questionEndLines(content)
  return questions.map((question) => {
    const start = question.headingLine
    const end = Math.max(start, endLines.get(start) ?? start)
    const questionMarkers = markers.filter((m) => m.line >= start && m.line <= end)
    const assigned = new Set<FootnoteMarker>()

    const optionChildren: SteeringOutlineNode[] = question.options.map((option) => {
      const optionMarkers = questionMarkers.filter(
        (m) => m.line >= option.sourceLine && m.line <= option.endLine,
      )
      optionMarkers.forEach((m) => assigned.add(m))
      const footnotes = optionMarkers.map((m) => footnoteLeaf(lines, definitionByName, m))
      const impactsDetail = bodyText(option.body)
      return {
        name: `${option.checked ? "[x]" : "[ ]"} ${option.text || "your answer"}`,
        ...(impactsDetail.length > 0 ? { detail: impactsDetail } : {}),
        range: spanRange(lines, option.sourceLine, option.endLine),
        selectionRange: lineRange(lines, option.sourceLine),
        // `leaf: true` means "no children of its own" (SteeringFormat.ts) —
        // an option with a footnote child is no longer one, matching
        // review.ts's chunk nodes (children, no `leaf`).
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

/** Sets an explicit `checked` STATE, unlike `pickOptionEdits`, which assumes the target is not already ticked. `true` is radio (unticks every sibling); `false` only unticks the target. */
const setOptionCheckedEdits = (
  content: string,
  question: OpenQuestion,
  option: QuestionOption,
  checked: boolean,
): SteeringEdit[] => {
  if (!checked) {
    if (!option.checked) return []
    const edit = toggleCheckbox(content, option.sourceLine)
    return edit ? [edit] : []
  }
  const edits: SteeringEdit[] = []
  for (const sibling of question.options) {
    const isTarget = sibling.sourceLine === option.sourceLine
    if (isTarget ? sibling.checked : !sibling.checked) continue
    const edit = toggleCheckbox(content, sibling.sourceLine)
    if (edit) edits.push(edit)
  }
  return edits
}

/** Replaces the WHOLE `optionTextSpan`, wrap and all — used only for the free-text slot, whose placeholder or prior answer the typed answer replaces in place. */
const replaceOptionTextEdit = (
  content: string,
  item: ListItem,
  text: string,
): SteeringEdit | undefined => {
  const span = optionTextSpan(item)
  if (!span) return undefined
  return {
    range: {
      start: toLspPositionFromOffset(content, span.start),
      end: toLspPositionFromOffset(content, span.end),
    },
    newText: text,
  }
}

/**
 * Collapses a typed answer to the single-line shape a list-item label must
 * be. A raw textarea value's interior newlines would break `.gtd/`'s oxfmt
 * fixed point the moment they are spliced onto a `- [x] ` line, and every
 * steering file — server-written ones included — is covered by `format:check`.
 */
/**
 * Empty normalizes to `FREE_TEXT_PLACEHOLDER`, never `""`: an empty label
 * leaves nothing after the marker, which `optionContentOffset` cannot find an
 * offset for, breaking this anchor's `apply` forever. The placeholder reads
 * back as `""`, so an erase still reads as unanswered.
 */
const normalizeFreeTextAnswer = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length === 0 ? FREE_TEXT_PLACEHOLDER : normalized
}

/** Only the `option` anchor resolves here. `checked` defaults to `true`, and `text` is normalized and replaces the label in the SAME edit set as the tick — never a second call, never the raw textarea value. */
const questionsApply: SteeringFormat["apply"] = (content, anchor, opts) => {
  if (anchor.kind !== "option") return { ok: false, reason: "anchor-not-found" }
  const { questions } = parseOpenQuestions(content)
  const question = questions[anchor.questionIndex]
  const option = question?.options[anchor.index]
  if (!question || !option) return { ok: false, reason: "anchor-not-found" }

  const checked = opts.checked ?? true
  const edits = setOptionCheckedEdits(content, question, option, checked)

  if (opts.text !== undefined) {
    const tree = parseMarkdown(content)
    const item = taskItems(tree).find(
      (it) => toLspPosition(it.position!.start).line === option.sourceLine,
    )
    const textEdit = item
      ? replaceOptionTextEdit(content, item, normalizeFreeTextAnswer(opts.text))
      : undefined
    if (textEdit) edits.push(textEdit)
  }

  return { ok: true, edits }
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
 * Where a footnote lands: the containing top-level block node's end line. One
 * rule, not a case per shape — and resolving from the cursor's OWN node means
 * prose between two option lists anchors to that prose, not the second list.
 */
const footnoteBlockEnd = (tree: Root, cursorLine: number): number => {
  const block = blockNodeAt(tree, cursorLine)
  return block?.position ? toLspPosition(block.position.end).line : cursorLine
}

/** Pick/uncheck on an open question's option; "add a footnote" LAST, after every option action, and everywhere EXCEPT inside an existing marker's span or on a definition's line, where a new marker would corrupt the footnote already there. */
const questionActions: SteeringFormat["actions"] = (content, range) => {
  const { questions } = parseOpenQuestions(content)
  const tree = parseMarkdown(content)
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
  if (!isOnExistingFootnote(content, range.start)) {
    actions.push({
      title: FOOTNOTE_ACTION_TITLE,
      edits: footnoteAdditionEdits(content, range.start, footnoteBlockEnd(tree, cursorLine)),
    })
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

/**
 * `true` when top-level node `n` is the `## Open Questions`/`## Answered
 * Questions` heading itself — the client renders those as its own section
 * headers, so `blockNodesOf` never emits a block node for either.
 */
const isQuestionsSectionHeading = (content: string, n: RootContent): n is Heading =>
  n.type === "heading" &&
  n.depth === 2 &&
  (headingText(content, n) === "Open Questions" || headingText(content, n) === "Answered Questions")

/**
 * Every `[headingLine, endLine]` span a real question block owns, across
 * both sections (`questionEndLines`, already computed for the outline) —
 * `blockNodesOf` skips any top-level node whose OWN start line falls inside
 * one of these, since that content is already projected as the question's
 * `question`/`option` node pair, never a second, competing block node.
 */
const isInsideQuestionSpan = (spans: ReadonlyMap<number, number>, line: number): boolean => {
  for (const [start, end] of spans) {
    if (line >= start && line <= end) return true
  }
  return false
}

/**
 * Every top-level block FIRST — the phone's "Read the plan" row needs a plan,
 * and without this a document with any question would drop its intro prose —
 * then every question as a container with its options as children. `title` is
 * the heading TEXT, never the first body line, which rides as `detail`. ONE
 * parse plus one block walk, never one parse per question.
 */
const questionsView = (content: string): SteeringView => {
  const tree = parseMarkdown(content)
  const spans = questionEndLines(content)
  const blockNodes = blockNodesOf(content, tree, {
    skipNode: isQuestionsSectionHeading,
    skipLine: (line) => isInsideQuestionSpan(spans, line),
  })
  const { questions } = parseOpenQuestions(content)
  return {
    nodes: [
      ...blockNodes,
      ...questions.map((question, questionIndex) => ({
        title: question.question,
        detail: question.text,
        detailInline: question.bodyInline,
        status: question.status,
        answered: question.answered,
        anchor: { kind: "question" as const, index: questionIndex },
        body: question.bodyNodes,
        children: question.options.map((option, index) => ({
          title: option.text,
          checked: option.checked,
          anchor: { kind: "option" as const, questionIndex, index },
          // The free-text slot never carries impacts of its own — see
          // `QuestionOption.body`'s own doc comment.
          ...(option.freeText ? {} : { body: option.body }),
        })),
      })),
    ],
  }
}

/** Resolves a `question` anchor: attaches at the end of the question's own heading line, the definition landing after the question's whole block (`questionEndLines`). `undefined` for a stale `index`. */
const resolveQuestionAnchor = (
  content: string,
  lines: readonly string[],
  questions: readonly OpenQuestion[],
  index: number,
): FootnoteAnchor | undefined => {
  const question = questions[index]
  if (!question) return undefined
  const end = Math.max(
    question.headingLine,
    questionEndLines(content).get(question.headingLine) ?? question.headingLine,
  )
  return {
    line: question.headingLine,
    endCharacter: (lines[question.headingLine] ?? "").length,
    blockEndLine: end,
    key: `question:${question.headingLine}`,
  }
}

/** Resolves an `option` anchor: attaches at the end of the option's own source line, the definition landing after the option's whole span (`option.endLine`). `undefined` for a stale `questionIndex`/`index`. */
const resolveOptionAnchor = (
  lines: readonly string[],
  questions: readonly OpenQuestion[],
  questionIndex: number,
  index: number,
): FootnoteAnchor | undefined => {
  const option = questions[questionIndex]?.options[index]
  if (!option) return undefined
  return {
    line: option.sourceLine,
    endCharacter: (lines[option.sourceLine] ?? "").length,
    blockEndLine: option.endLine,
    key: `option:${option.sourceLine}`,
  }
}

/** Resolves a `paragraph` anchor: attaches at the end of `line`'s own text, the definition landing after that line's containing top-level block node. `undefined` when `line` isn't inside a real block. */
const resolveQuestionsParagraphAnchor = (
  tree: Root,
  lines: readonly string[],
  line: number,
): FootnoteAnchor | undefined => {
  const block = blockNodeAt(tree, line)
  if (!block?.position) return undefined
  return {
    line,
    endCharacter: (lines[line] ?? "").length,
    blockEndLine: toLspPosition(block.position.end).line,
    key: `paragraph:${line}`,
  }
}

/**
 * Resolves a `question`/`option`/`paragraph` `SteeringAnchor` against
 * `content` into the low-level `FootnoteAnchor` `Footnotes.ts#footnoteAttachEdits`
 * wants — `undefined` for a `chunk`/`hunk` anchor (not this format's own
 * kind) or an index/line that no longer resolves.
 */
const resolveQuestionsAnchor = (
  content: string,
  tree: Root,
  lines: readonly string[],
  questions: readonly OpenQuestion[],
  anchor: SteeringAnchor,
): FootnoteAnchor | undefined => {
  switch (anchor.kind) {
    case "question":
      return resolveQuestionAnchor(content, lines, questions, anchor.index)
    case "option":
      return resolveOptionAnchor(lines, questions, anchor.questionIndex, anchor.index)
    case "paragraph":
      return resolveQuestionsParagraphAnchor(tree, lines, anchor.line)
    default:
      return undefined
  }
}

/** `qa`-mode's `annotate`: resolves `anchor` then delegates the two-edit mechanics (`text` carried through verbatim as the new definition's body) to `Footnotes.ts#footnoteAttachEdits`. */
const questionsAnnotate = (
  content: string,
  anchor: SteeringAnchor,
  text: string,
): SteeringAnnotateResult => {
  const { questions } = parseOpenQuestions(content)
  const tree = parseMarkdown(content)
  const lines = content.split(/\r?\n/)
  const resolved = resolveQuestionsAnchor(content, tree, lines, questions, anchor)
  if (!resolved) return { ok: false, reason: "anchor-not-found" }
  const result = footnoteAttachEdits(content, resolved, text)
  if (!result.ok) return result
  return { ok: true, edits: result.edits }
}

/**
 * `qa`'s ticks ARE its answers — an "uncheck" that blindly cleared every
 * checked box would erase a human's answer, not reset read progress like
 * `review`'s hunk ticks. So `qa`'s `clearTicks` is a deliberate no-op: there
 * is nothing here that is ever safe to auto-clear.
 */
const qaClearTicks = (content: string): string => content

/** The `qa` steering descriptor: gtd's own in-process open-questions checkbox format — validation, outline, code actions, a footnote-only `pointerAt`, a no-op `clearTicks`, and the answer-completeness predicate (`unansweredQuestions`). Every structural finding carries a line and a range spanning the node it's about. */
export const qaDescriptor: SteeringFormat = {
  sample: QA_SAMPLE,
  validate: (content) => [
    ...parseOpenQuestions(content).findings,
    ...parseFootnotes(content).findings,
  ],
  outline: questionsOutline,
  actions: questionActions,
  pointerAt: questionsPointerAt,
  view: questionsView,
  annotate: questionsAnnotate,
  apply: questionsApply,
  clearTicks: qaClearTicks,
  unansweredQuestions,
}
