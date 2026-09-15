import type { Code, Heading, List, ListItem, Root, RootContent } from "mdast"
import type { FootnoteAnchor, FootnoteMarker } from "./Footnotes.js"
import {
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
  sourceText,
  spanRange,
  taskItems,
  toLspPosition,
  toLspPositionFromOffset,
  type HeadingBlock,
} from "./MarkdownTree.js"
import type {
  BlockListItem,
  SteeringAnchor,
  SteeringAnnotateResult,
  SteeringEdit,
  SteeringFinding,
  SteeringFormat,
  SteeringOutlineNode,
  SteeringView,
  SteeringViewNode,
} from "./SteeringFormat.js"
import type { SteeringDescriptor } from "./Descriptor.js"

type OpenQuestionStatus = "open" | "answered"

/**
 * A marker's shape once it's plain text: `[^name]`, no whitespace, no `]` —
 * mirrors `Footnotes.ts`'s own orphan-marker pattern. Local to this module:
 * `headingText`, `firstBodyLineText`, and `optionText` (below) each extract
 * text that is NOT a full node's own tree span (a heading's synthetic
 * children span, or a raw line slice) — `sourceText`'s own real-reference
 * exclusion only covers the former, so a marker (real, matched-by-definition
 * as much as orphan) still needs stripping out of the resulting string by
 * its own literal shape either way.
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

 * The `qa` descriptor's canonical sample: one open question with two options plus the
 * unfilled free-text slot, one hand-authored footnote on Option A with a body
 * over 80 characters, and a SECOND footnote on Option B, attached exactly the
 * way the server attaches one (`questionsAnnotate` →
 * `Footnotes.ts#footnoteAttachEdits`, hence its `na`-prefixed id, distinct
 * from the hand-authored `fn` one) — its body also over 80 characters and
 * carrying a multi-word inline code span, so `ModeContradiction.ts`'s
 * formatter round-trip covers a server-written note reflowing, not just a
 * hand-authored one. Pinned already in oxfmt's own wrapped four-space form
 * (see `src/steering/SteeringFormats.test.ts`'s formatter round-trip). Not
 * authored to survive any particular formatter.
 */
const QA_SAMPLE = `Sample plan. Add a thing.

## Open Questions

### Which option?

- [ ] Option A[^fn1]
- [ ] Option B[^na17v2bjb]

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
}

interface OpenQuestion {
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
  return stripMarkerText((lines[lineIndex] ?? "").trim())
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
 * has no notion of a sub-option. Below a shallow (under 4 spaces) indent this
 * is unremarkable — a real sub-list CommonMark itself distinguishes from a
 * top-level option, no different from any other nested content. At 4+
 * spaces, though, it's exactly the shape the old indent-tolerant
 * `CHECKBOX_RE` DID count as an option — so it's genuinely lost from this
 * format's output at that indent, and `recognizedStructureLines` (below)
 * does NOT protect it from `strictReadingFindings`: only a node at or above
 * the TOP level is excluded from that refusal, precisely so a 4+-space
 * nested option (or a heading folded into a lazy continuation the same way)
 * still gets a positioned finding instead of silently vanishing.
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
 * did). When the marker is alone on its own line and the item's content
 * starts on the NEXT line (an indented or lazy wrap), `optionContentOffset`
 * still resolves to a real offset — just one on that later line, not the
 * marker's own — so the line the offset itself falls on is checked against
 * `sourceLine` before slicing; a mismatch means there is no text on the
 * marker's own line, and `""` is correct (matching the old regex, which
 * never captured a continuation line into `text` either).
 */
const optionText = (content: string, lines: readonly string[], item: ListItem): string => {
  const offset = optionContentOffset(item)
  if (offset === undefined || !item.position) return ""
  const sourceLine = toLspPosition(item.position.start).line
  const contentPosition = toLspPositionFromOffset(content, offset)
  if (contentPosition.line !== sourceLine) return ""
  const raw = (lines[sourceLine] ?? "").slice(contentPosition.character)
  return stripMarkerText(raw).trim()
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
    }
  })
}

/**
 * The exact three fields `isAnswered` reads — deliberately narrower than the
 * full `QuestionOption` (which also carries `sourceLine`/`endLine`, meaningless
 * off the server), so a CLIENT can build this shape from its own local radio
 * state (`Question.tsx`) and call the identical predicate, rather than
 * re-deriving a second, divergent rule. `QuestionOption` itself already
 * satisfies this structurally.
 */
export interface AnsweredOption {
  readonly checked: boolean
  readonly text: string
  readonly freeText: boolean
}

/**
 * An OPEN question is answered iff EXACTLY ONE option is ticked and — when that
 * option is the free-text slot — its (placeholder-normalized) text is non-empty.
 * Zero ticks (unanswered), two+ ticks (ambiguous), or a ticked-but-empty
 * free-text slot all read as not answered. T5's own "already exists and is
 * the single one enforced" acceptance bullet: `Question.tsx` calls this SAME
 * function (via `AnsweredOption`) rather than recomputing the rule.
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
  lines: readonly string[],
  block: QuestionBlock,
  status: OpenQuestionStatus,
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
 * not a heading) never counts as the section either. Each finding's range
 * points at ONE offending heading — the first section (`h2[0]`) for the
 * "before" violation, the last (`h2[h2.length - 1]`) for the "after" one —
 * since either is, by construction, always one of the offenders when its
 * violation fires.
 *
 * Known gap, out of this package's scope: a `## Open Questions` heading
 * itself indented 4+ spaces parses as indented code too, so the whole
 * section (and every question in it) goes unrecognized with no finding —
 * `strictReadingFindings` only covers the `### ` heading and `- [ ]` option
 * shapes this package's acceptance criteria name, not the section heading.
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

/**
 * Every 0-based line inside a NESTED `heading` or `list` descendant of a
 * top-level task-list `item` — the part of that item's own span this
 * format's `optionListItems` (above) never looks past. A lazy continuation
 * heading or a nested sub-list is real, correctly-parsed tree structure, but
 * it's still lost from this format's OUTPUT (no option, no question — the
 * old indent-tolerant `CHECKBOX_RE` would have counted it as one), so
 * `recognizedStructureLines` must not blanket-exclude it just because it
 * sits inside a real item's overall span.
 */
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
 * Every 0-based line already inside a TOP-LEVEL `heading` (depth 2 or 3 —
 * the only depths this format recognizes), a TOP-LEVEL task-list `listItem`'s
 * own span (a direct child of a `list` that is itself a direct child of the
 * tree) — MINUS any `heading`/`list` nested inside that item
 * (`nestedBlockLines`) — or a `footnoteDefinition`'s ENTIRE span, whole.
 * `strictReadingFindings` never flags a line in what's left.
 *
 * The heading/list-item exclusion covers what's legitimately part of the
 * tree already, in a shape this format actually consumes; anything at a
 * DEEPER nesting depth there is NOT excluded, however validly CommonMark
 * parses it — `optionListItems` never looks past the top level, so that
 * content is just as lost from this format's output as an unindented line
 * would be, and the refusal must still be able to flag it. A genuinely
 * shallow (under 4 spaces) nested sub-item is unaffected either way, via the
 * `raw` indent guard in `strictReadingFindingsInRange`.
 *
 * A footnote definition is different in kind, not degree: it is the human's
 * own free-text comment channel, never itself a candidate heading or option
 * under ANY reading (loose or strict) — the refusal exists to catch content
 * lost from this format's OUTPUT, and a footnote body was never part of that
 * output to begin with. So its whole span is excluded unconditionally, at
 * whatever nesting a human happens to write inside it — this repo's own
 * footnote style (`QA_SAMPLE`) indents a definition's continuation lines
 * four spaces, exactly the threshold that would otherwise misfire here.
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
 * Parses the open-questions structure out of `content`, plus every finding
 * `qaDescriptor.validate` reports — every finding here carries a `line` AND a
 * `range` spanning the node it's about (the section-order and empty-heading
 * findings included; only `strictReadingFindings`' own line-shaped findings
 * never had a real node to begin with, so their range spans the raw offending
 * line instead). This IS `parseOpenQuestions` — there is no second parse
 * function to route around its own return type, mirroring `review.ts`'s
 * single `parseReviewDoc`.
 */
export const parseOpenQuestions = (content: string): OpenQuestionsDoc => {
  const tree = parseMarkdown(content)
  const lines = content.split(/\r?\n/)

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
      const result = parseQuestionBlock(content, lines, block, status)
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

/** Every OPEN question that is not answered — the answer-completeness guard (`src/step/Guards.ts`) refuses a step while this is non-empty. */
const unansweredQuestions = (content: string): readonly OpenQuestion[] =>
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
      return {
        name: `${option.checked ? "[x]" : "[ ]"} ${option.text || "your answer"}`,
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

/**
 * The `apply`-callable counterpart to `pickOptionEdits`: sets `option` to an
 * explicit `checked` STATE rather than assuming (as `pickOptionEdits`'s own
 * caller, `optionAction`, does) that the target isn't already ticked.
 * `checked: true` is radio semantics — ticks the target (only if not already
 * ticked) and unticks every OTHER already-ticked sibling; `checked: false`
 * only unticks the target itself, leaving siblings untouched.
 */
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

/**
 * The edit that replaces `option`'s own label text — everything after the
 * checkbox marker, on its source line only — with `text` verbatim: used only
 * for the free-text slot, whose placeholder (or prior answer) the human's
 * typed answer replaces in place. `undefined` when the option's content
 * doesn't start on its own source line (mirrors `optionText`'s identical
 * guard) — there is no single-line span left to replace.
 */
const replaceOptionTextEdit = (
  content: string,
  lines: readonly string[],
  item: ListItem,
  option: QuestionOption,
  text: string,
): SteeringEdit | undefined => {
  const offset = optionContentOffset(item)
  if (offset === undefined) return undefined
  const position = toLspPositionFromOffset(content, offset)
  if (position.line !== option.sourceLine) return undefined
  const lineLength = (lines[option.sourceLine] ?? "").length
  return {
    range: { start: position, end: { line: option.sourceLine, character: lineLength } },
    newText: text,
  }
}

/**
 * Collapses a human-typed free-text answer to the single-line,
 * whitespace-trimmed shape a list-item's own label must be — a raw textarea
 * value can carry interior newlines or trailing whitespace, either of which
 * would leave `.gtd/`'s own oxfmt fixed point broken the moment it's spliced
 * onto a `- [x] ` line (AGENTS.md's "`.gtd/` is formatted, not ignored" rule
 * — every steering file, including a server-written one, is covered by
 * `format:check`). Interior whitespace, a real newline included, collapses
 * to a single space — mirrors `headingText`'s identical normalization
 * elsewhere in this file, applied here to a WRITE rather than a read.
 */
/**
 * Empty normalizes to `FREE_TEXT_PLACEHOLDER`, never to `""` — an empty
 * label leaves `- [ ] ` with nothing after the marker, which
 * `optionContentOffset` can't find a content offset for (its own guard
 * requires content ON the marker's line), permanently breaking this
 * anchor's own `apply` from then on (`anchor-not-found`, forever). Package
 * 03's Task 6 erase path relies on this: writing the placeholder instead
 * keeps the option re-editable, and `parseOptions` already normalizes the
 * placeholder back to `""` on read, so an erase still reads back as
 * unanswered.
 */
const normalizeFreeTextAnswer = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length === 0 ? FREE_TEXT_PLACEHOLDER : normalized
}

/**
 * `qa`-mode's `apply`: only the `option` anchor resolves here — a
 * `chunk`/`hunk` anchor (not this format's own kind) refuses
 * `anchor-not-found`, mirroring `resolveQuestionsAnchor`'s own discipline.
 * `opts.checked` defaults to `true` (picking an option always ticks it; there
 * is no "leave it as found" case). `opts.text`, when given, is normalized
 * (`normalizeFreeTextAnswer`) and replaces the option's own label in the SAME
 * edit set as the tick — never a second `apply` call, and never the raw
 * textarea value verbatim.
 */
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
    const lines = content.split(/\r?\n/)
    const item = taskItems(tree).find(
      (it) => toLspPosition(it.position!.start).line === option.sourceLine,
    )
    const textEdit = item
      ? replaceOptionTextEdit(content, lines, item, option, normalizeFreeTextAnswer(opts.text))
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
 * The block a footnote lands after when "add a footnote" fires with the
 * cursor at `cursorLine`: the containing top-level block NODE's own end line
 * (`blockNodeAt`) — a `list` node's own span IS the whole contiguous list
 * (never split between two items), so this covers "inside a question's
 * option list" the same way it covers question-body prose ABOVE a list, a
 * question with no options at all, and any cursor position outside every
 * question — one rule, not a special case per shape. Resolving from the
 * cursor's OWN containing node (rather than aggregating every option across
 * a whole question) also means a question with TWO separate option lists
 * resolves prose written between them to that prose's own span, never to the
 * second list's end. Falls back to `cursorLine` itself only past the end of
 * the document, where no block node exists.
 */
const footnoteBlockEnd = (tree: Root, cursorLine: number): number => {
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
      edits: footnoteAdditionEdits(content, range.start, footnoteBlockEnd(tree, cursorLine)),
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
 * The flattened, marker-stripped, whitespace-collapsed text of a run of
 * sibling BLOCK nodes (a blockquote's own children, a list item's own
 * non-list children) — built by taking EACH child's own `sourceText`
 * individually and joining the results, never by slicing one span from the
 * first child's start to the last child's end. A single shared span would
 * include every byte BETWEEN the children verbatim — a nested `list`
 * filtered out of a list item's own children (see `listItemText`) still
 * sits, raw markdown and all, between its neighbors' offsets; a blockquote's
 * OWN `> ` continuation markers between two paragraphs sit there too (each
 * child's own position starts right after its line's `> `, but the raw text
 * BETWEEN two children's positions still crosses that marker). Per-child
 * `sourceText` also excises each child's own real footnote reference by its
 * OWN position, never merely regex-stripping the literal `[^name]` shape.
 */
const childrenText = (content: string, children: readonly RootContent[]): string =>
  children
    .map((child) => stripMarkerText(sourceText(content, child)))
    .filter((text) => text.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

/**
 * One list item's own text, EXCLUDING any nested `list` child (that's a
 * separate, recursive `items` entry — see `blockListItemOf`).
 */
const listItemText = (content: string, item: ListItem): string =>
  childrenText(
    content,
    item.children.filter((c) => c.type !== "list"),
  )

/** One list item as a `BlockListItem`, recursing into a nested `list` child (there is at most one, CommonMark's own shape) as its own `items`. */
const blockListItemOf = (content: string, item: ListItem): BlockListItem => {
  const nested = item.children.filter((c): c is List => c.type === "list")
  const items = nested.flatMap((list) => blockListItemsOf(content, list.children))
  return {
    text: listItemText(content, item),
    ...(item.checked === true || item.checked === false ? { checked: item.checked } : {}),
    ...(items.length > 0 ? { items } : {}),
  }
}

/** Every item of a `list` node's own `children`, as `BlockListItem`s, in document order. */
const blockListItemsOf = (content: string, items: readonly ListItem[]): readonly BlockListItem[] =>
  items.map((item) => blockListItemOf(content, item))

/** The `title` an empty fenced code block (a `` ``` ``/`` ``` `` pair with nothing between them) falls back to — its real body is `""`, and Task 2's "every node still carries a non-empty title" allows no exception for it. */
const EMPTY_CODE_BLOCK_TITLE = "(empty code block)"

/**
 * A top-level node's own one-line, marker-stripped, whitespace-collapsed
 * text — every block kind's `title` (Task 2's "every node still carries a
 * non-empty title"), and reused verbatim as a `blockquote`'s own `text`.
 * `heading`/`blockquote` use `childrenText` (their own CHILDREN span — the
 * NODE's own position starts at the `#` run / the `>` marker, which
 * `sourceText` would otherwise pull in); `code` uses its `value` directly
 * (never `sourceText`, which would pull in the fence lines), falling back to
 * `EMPTY_CODE_BLOCK_TITLE` when that value is blank; everything else uses
 * `sourceText` over the node's own span.
 */
const blockTitle = (content: string, node: RootContent): string => {
  if (node.type === "heading") return headingText(content, node)
  if (node.type === "blockquote") return childrenText(content, node.children)
  if (node.type === "code") {
    const text = stripMarkerText(node.value).replace(/\s+/g, " ").trim()
    return text.length > 0 ? text : EMPTY_CODE_BLOCK_TITLE
  }
  return stripMarkerText(sourceText(content, node)).replace(/\s+/g, " ").trim()
}

/**
 * `SteeringViewNode.block` for one top-level node — `undefined` for a kind
 * `blockNodesOf` doesn't project structure for (a `thematicBreak`, an `html`
 * node, …), which still renders via `title` alone (Task 4's `ProseBlock`
 * default branch). `code`'s `text` is `node.value` VERBATIM — leading
 * whitespace intact, never whitespace-collapsed like every other kind's
 * `title` — and its `language` is the fence's own info string, omitted
 * entirely when there is none (`node.lang` is `null`/`undefined`).
 */
const blockOf = (content: string, node: RootContent): SteeringViewNode["block"] | undefined => {
  switch (node.type) {
    case "heading":
      return { kind: "heading", depth: node.depth }
    case "list":
      return {
        kind: "list",
        ordered: node.ordered === true,
        items: blockListItemsOf(content, node.children),
      }
    case "code":
      return {
        kind: "code",
        text: node.value,
        ...(node.lang !== null && node.lang !== undefined ? { language: node.lang } : {}),
      }
    case "blockquote":
      return { kind: "blockquote", text: blockTitle(content, node) }
    case "paragraph":
      return { kind: "paragraph" }
    default:
      return undefined
  }
}

/**
 * Every top-level block of the document becomes a view node, in document
 * order — headings, lists, code blocks, blockquotes and paragraphs alike,
 * before the questions section, between two question sections, and after
 * them too. Skips exactly two things: the `## Open Questions`/`## Answered
 * Questions` heading NODEs themselves (`isQuestionsSectionHeading` — the
 * client renders those as its own section headers), and any node whose own
 * start line falls inside a real question's span (`isInsideQuestionSpan` —
 * already projected as that question's own `question`/`option` node pair).
 * A `footnoteDefinition` is skipped unconditionally: it is the note ITSELF,
 * surfaced below as a node's own `note`, never new document content in its
 * own right. Every node still carries a real, server-computed
 * `{kind:"paragraph", line}` anchor at its own start line — `SteeringAnchor`
 * gains no new member for the new `block` kinds (Task 3) — and an existing
 * footnote marker anchored at that same line surfaces as the node's own
 * `note` (mirrors `ReviewDoc.ts#chunkNoteOf`'s exact-line-match convention),
 * so a block already carrying a note offers editing it, not a second one.
 */
const blockNodesOf = (content: string, tree: Root): readonly SteeringView["nodes"][number][] => {
  const { markers, definitions } = parseFootnotes(content)
  const definitionByName = new Map(definitions.map((d) => [d.name, d.body]))
  const spans = questionEndLines(content)
  return tree.children
    .filter((node) => node.position !== undefined)
    .filter((node) => node.type !== "footnoteDefinition")
    .filter((node) => !isQuestionsSectionHeading(content, node))
    .filter((node) => !isInsideQuestionSpan(spans, toLspPosition(node.position!.start).line))
    .map((node) => {
      const startLine = toLspPosition(node.position!.start).line
      const noteBodies = markers
        .filter((marker) => marker.line === startLine)
        .map((marker) => definitionByName.get(marker.name))
        .filter((body): body is string => body !== undefined)
      const block = blockOf(content, node)
      return {
        title: blockTitle(content, node),
        anchor: { kind: "paragraph" as const, line: startLine },
        ...(block !== undefined ? { block } : {}),
        ...(noteBodies.length > 0 ? { note: noteBodies.join(" ") } : {}),
      }
    })
}

/**
 * `qa`-mode's `view`: every top-level block of the document (`blockNodesOf`
 * — prose, headings, lists, code, blockquotes; a prose-only document with no
 * `## Open Questions`/`## Answered Questions` section at all yields these
 * and nothing else) FIRST — requirement 4/T5's "Read the plan" row needs an
 * actual plan to read; without this, a `qa` document with any open/answered
 * question would drop its own intro prose entirely — followed by every
 * question as a container node: `title` the question's own heading TEXT
 * (`OpenQuestion.question`, never `OpenQuestion.text`, which is only the
 * first body line, a summary carried separately as `detail`), plus
 * status/answered flag and own `question` anchor — with every one of its
 * options as a child item node (checked, text as `title`, own `option`
 * anchor). Built from ONE `parseOpenQuestions` call plus one `blockNodesOf`
 * walk, never one parse per question/option. Uses `SteeringViewNode`'s
 * generic shape, never a `qa`-only type — see that type's own doc comment.
 */
const questionsView = (content: string): SteeringView => {
  const tree = parseMarkdown(content)
  const blockNodes = blockNodesOf(content, tree)
  const { questions } = parseOpenQuestions(content)
  return {
    nodes: [
      ...blockNodes,
      ...questions.map((question, questionIndex) => ({
        title: question.question,
        detail: question.text,
        status: question.status,
        answered: question.answered,
        anchor: { kind: "question" as const, index: questionIndex },
        children: question.options.map((option, index) => ({
          title: option.text,
          checked: option.checked,
          anchor: { kind: "option" as const, questionIndex, index },
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
export const qaDescriptor: SteeringDescriptor = {
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
