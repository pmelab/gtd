import { blockNodesOf } from "./Blocks.js"
import { eolOf } from "./Eol.js"
import { footnoteAdditionEdits, footnotePointerAt, nextFootnoteName } from "./Footnotes.js"
import { blockNodeAt, parseMarkdown, toLspPosition } from "./MarkdownTree.js"
import type {
  SteeringAction,
  SteeringAnchor,
  SteeringAnnotateResult,
  SteeringEdit,
  SteeringFormat,
  SteeringLink,
  SteeringOutlineNode,
  SteeringViewNode,
} from "./SteeringFormat.js"
import { answerFindings } from "./WidgetRules.js"
import {
  CUSTOM_ANSWER_EMOJI,
  parseWidgets,
  WIDGET_EMOJI,
  type InputWidget,
  type Widget,
} from "./Widgets.js"

export const ANNOTATE_ACTION_TITLE = "gtd: add an annotation"

const SAMPLE = `# Plan

## 🔘 Which store?

- [ ] Redis
- [ ] ✏️
`

/** One checkbox of an input widget: an option, the custom answer, or a hunk. */
interface Box {
  readonly line: number
  readonly checked: boolean
}

const inputs = (widgets: readonly Widget[]): readonly InputWidget[] =>
  widgets.filter((w): w is InputWidget => w.kind !== "static")

const boxesOf = (widget: InputWidget): readonly Box[] => {
  if (widget.kind === "review-checklist") return widget.hunks
  if (widget.kind === "boolean") {
    return [{ line: widget.itemLine, checked: widget.checked }]
  }
  return widget.custom === undefined ? widget.options : [...widget.options, widget.custom]
}

const BOX_RE = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]/

/** The edit that sets the checkbox on `line`. */
const boxEdit = (
  lines: readonly string[],
  line: number,
  checked: boolean,
): SteeringEdit | undefined => {
  const match = BOX_RE.exec(lines[line] ?? "")
  if (match === null) return undefined
  const character = (match[1] ?? "").length + 1
  return {
    range: { start: { line, character }, end: { line, character: character + 1 } },
    newText: checked ? "x" : " ",
  }
}

const customEdit = (
  lines: readonly string[],
  line: number,
  checked: boolean,
  text: string,
  eol: string,
): SteeringEdit | undefined => {
  const match = BOX_RE.exec(lines[line] ?? "")
  if (match === null) return undefined
  const body = text.trim().split(/\r?\n/).join(`${eol}      `)
  return {
    range: { start: { line, character: 0 }, end: { line, character: (lines[line] ?? "").length } },
    newText: `${match[1]}[${checked ? "x" : " "}] ${CUSTOM_ANSWER_EMOJI}${body === "" ? "" : ` ${body}`}`,
  }
}

const done = (edits: readonly (SteeringEdit | undefined)[]): SteeringAnnotateResult =>
  edits.some((e) => e === undefined)
    ? { ok: false, reason: "anchor-not-found" }
    : { ok: true, edits: edits as SteeringEdit[] }

/** Ticking a single select's box unticks every other; any other box only changes itself. */
const setBox = (
  content: string,
  widget: InputWidget,
  index: number,
  opts: { readonly checked?: boolean; readonly text?: string },
): SteeringAnnotateResult => {
  const lines = content.split("\n")
  const boxes = boxesOf(widget)
  const target = boxes[index]
  if (target === undefined) return { ok: false, reason: "anchor-not-found" }
  const checked = opts.checked ?? target.checked
  const isCustom =
    (widget.kind === "single-select" || widget.kind === "multi-select") &&
    widget.custom !== undefined &&
    index === boxes.length - 1
  const own = isCustom
    ? customEdit(
        lines,
        target.line,
        checked,
        opts.text ?? widget.custom?.text ?? "",
        eolOf(content),
      )
    : boxEdit(lines, target.line, checked)
  const others =
    widget.kind === "single-select" && checked
      ? boxes
          .filter((box, i) => i !== index && box.checked)
          .map((box) => boxEdit(lines, box.line, false))
      : []
  return done([own, ...others])
}

const widgetAt = (content: string, index: number): InputWidget | undefined =>
  inputs(parseWidgets(content).widgets)[index]

/** Replaces the whole document with `content` plus `text` as a new last paragraph. */
const appendEdit = (content: string, text: string): SteeringEdit => {
  const eol = eolOf(content)
  const lines = content.split("\n")
  const trimmed = content.replace(/\s+$/, "")
  const added = text.split(/\r?\n/).join(eol)
  const newText =
    text.length === 0
      ? trimmed.length > 0
        ? `${trimmed}${eol}`
        : ""
      : trimmed.length > 0
        ? `${trimmed}${eol}${eol}${added}${eol}`
        : `${added}${eol}`
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: lines.length - 1, character: (lines[lines.length - 1] ?? "").length },
    },
    newText,
  }
}

/** A person writing a file from scratch: text typed at the last line is a new paragraph. */
const applyParagraph = (
  content: string,
  line: number,
  opts: { readonly checked?: boolean; readonly text?: string },
): SteeringAnnotateResult => {
  const last = content.split(/\r?\n/).length - 1
  if (opts.checked !== undefined || opts.text === undefined || line < last)
    return { ok: false, reason: "anchor-not-found" }
  return { ok: true, edits: [appendEdit(content, opts.text)] }
}

const apply: SteeringFormat["apply"] = (content, anchor, opts) => {
  if (anchor.kind === "paragraph") return applyParagraph(content, anchor.line, opts)
  if (anchor.kind === "option" || anchor.kind === "hunk") {
    const index = anchor.kind === "option" ? anchor.questionIndex : anchor.chunkIndex
    const widget = widgetAt(content, index)
    return widget === undefined
      ? { ok: false, reason: "anchor-not-found" }
      : setBox(content, widget, anchor.index, opts)
  }
  if (anchor.kind === "question" || anchor.kind === "chunk") {
    const widget = widgetAt(content, anchor.index)
    if (widget?.kind !== "review-checklist") return { ok: false, reason: "anchor-not-found" }
    const lines = content.split("\n")
    return done(widget.hunks.map((hunk) => boxEdit(lines, hunk.line, opts.checked ?? true)))
  }
  return { ok: false, reason: "anchor-not-found" }
}

/** The 0-based line an anchor names, or `undefined` when it names nothing in `content`. */
const anchorLine = (content: string, anchor: SteeringAnchor): number | undefined => {
  if (anchor.kind === "paragraph") return anchor.line
  const index =
    anchor.kind === "hunk"
      ? anchor.chunkIndex
      : anchor.kind === "option"
        ? anchor.questionIndex
        : anchor.index
  const widget = widgetAt(content, index)
  if (widget === undefined) return undefined
  if (anchor.kind === "question" || anchor.kind === "chunk") return widget.line
  return boxesOf(widget)[anchor.index]?.line
}

/** A marker at the end of the anchored line and a one-line note at the end of the file. */
const annotate: SteeringFormat["annotate"] = (content, anchor, text) => {
  const line = anchorLine(content, anchor)
  const lines = content.split(/\r?\n/)
  if (line === undefined || blockNodeAt(parseMarkdown(content), line) === undefined)
    return { ok: false, reason: "anchor-not-found" }
  const eol = eolOf(content)
  const name = nextFootnoteName(content)
  const end = { line, character: (lines[line] ?? "").length }
  const last = lines.length - 1
  const tail = { line: last, character: (lines[last] ?? "").length }
  const body = text.trim().split(/\r?\n/).join(`${eol}    `)
  const lead = content.endsWith("\n") ? eol : `${eol}${eol}`
  return {
    ok: true,
    edits: [
      { range: { start: end, end }, newText: `[^${name}]` },
      { range: { start: tail, end: tail }, newText: `${lead}[^${name}]: ${body}${eol}` },
    ],
  }
}

const noteOf = (content: string, labels: readonly string[]): string | undefined => {
  const annotations = parseWidgets(content).annotations.filter((a) => labels.includes(a.label))
  return annotations.length === 0 ? undefined : annotations.map((a) => a.text).join("\n\n")
}

const inputNode = (
  content: string,
  widget: InputWidget,
  index: number,
  answered: boolean,
): SteeringViewNode => {
  const note = noteOf(content, widget.annotations)
  const base = {
    title: widget.title,
    status: widget.kind,
    answered,
    anchor: { kind: "question", index } as const,
    ...(widget.description === "" ? {} : { detail: widget.description }),
    ...(note === undefined ? {} : { note }),
  }
  if (widget.kind === "review-checklist") {
    return {
      ...base,
      children: widget.hunks.map((hunk, i) => ({
        title: hunk.note === "" ? hunk.pointer : `${hunk.pointer} — ${hunk.note}`,
        checked: hunk.checked,
        path: hunk.path.replace(/^\.\//, ""),
        line: hunk.start,
        ...(hunk.end === hunk.start ? {} : { endLine: hunk.end }),
        anchor: { kind: "hunk", chunkIndex: index, index: i } as const,
      })),
    }
  }
  if (widget.kind === "boolean") {
    return {
      ...base,
      children: [
        {
          title: widget.label,
          checked: widget.checked,
          anchor: { kind: "option", questionIndex: index, index: 0 },
        },
      ],
    }
  }
  const options: SteeringViewNode[] = widget.options.map((option, i) => ({
    title: option.label,
    checked: option.checked,
    anchor: { kind: "option", questionIndex: index, index: i },
  }))
  const custom: SteeringViewNode[] =
    widget.custom === undefined
      ? []
      : [
          {
            title: widget.custom.text,
            status: "custom",
            checked: widget.custom.checked,
            anchor: { kind: "option", questionIndex: index, index: widget.options.length },
          },
        ]
  return { ...base, children: [...options, ...custom] }
}

const view: SteeringFormat["view"] = (content) => {
  const { widgets } = parseWidgets(content)
  const blocks = blockNodesOf(content, parseMarkdown(content))
  const unanswered = new Set(
    answerFindings({ widgets, annotations: [], findings: [] }).map((f) => f.line),
  )
  let index = 0
  const nodes = widgets.flatMap((widget): SteeringViewNode[] => {
    if (widget.kind === "static") {
      return blocks.filter(
        (block) =>
          block.anchor.kind === "paragraph" &&
          block.anchor.line >= widget.line &&
          block.anchor.line <= widget.endLine,
      )
    }
    const node = inputNode(content, widget, index, !unanswered.has(widget.line))
    index += 1
    return [node]
  })
  return { nodes }
}

const lineRange = (lines: readonly string[], line: number) => ({
  start: { line, character: 0 },
  end: { line, character: (lines[line] ?? "").length },
})

const outline: SteeringFormat["outline"] = (content) => {
  const lines = content.split(/\r?\n/)
  return inputs(parseWidgets(content).widgets).map(
    (widget): SteeringOutlineNode => ({
      name: `${WIDGET_EMOJI[widget.kind]} ${widget.title}`,
      range: {
        start: lineRange(lines, widget.line).start,
        end: lineRange(lines, widget.endLine).end,
      },
      selectionRange: lineRange(lines, widget.line),
      children: boxesOf(widget).map((box) => ({
        name: (lines[box.line] ?? "").replace(BOX_RE, "").trim(),
        range: lineRange(lines, box.line),
        selectionRange: lineRange(lines, box.line),
        leaf: true,
      })),
    }),
  )
}

const action = (title: string, result: SteeringAnnotateResult): SteeringAction[] =>
  result.ok && result.edits.length > 0 ? [{ title, edits: result.edits }] : []

/** The tick actions for the checkbox or widget heading on `line`. */
const boxActions = (content: string, line: number): SteeringAction[] => {
  const all = inputs(parseWidgets(content).widgets)
  const index = all.findIndex((w) => line >= w.line && line <= w.endLine)
  const widget = all[index]
  if (widget === undefined) return []
  if (line === widget.line && widget.kind === "review-checklist") {
    return action(
      "gtd: tick every hunk",
      apply(content, { kind: "chunk", index }, { checked: true }),
    )
  }
  const boxes = boxesOf(widget)
  const at = boxes.findIndex((box) => box.line === line)
  const box = boxes[at]
  if (box === undefined) return []
  const anchor: SteeringAnchor =
    widget.kind === "review-checklist"
      ? { kind: "hunk", chunkIndex: index, index: at }
      : { kind: "option", questionIndex: index, index: at }
  const isCustom =
    widget.kind !== "review-checklist" &&
    widget.kind !== "boolean" &&
    widget.custom !== undefined &&
    at === boxes.length - 1
  if (isCustom)
    return action("gtd: write a custom answer", apply(content, anchor, { checked: true }))
  if (widget.kind === "single-select")
    return box.checked
      ? []
      : action("gtd: pick this option", apply(content, anchor, { checked: true }))
  return action(
    box.checked ? "gtd: untick" : "gtd: tick",
    apply(content, anchor, { checked: !box.checked }),
  )
}

const actions: SteeringFormat["actions"] = (content, range) => {
  const tree = parseMarkdown(content)
  const block = blockNodeAt(tree, range.start.line)
  const annotation: SteeringAction[] =
    block?.position === undefined || block.type === "footnoteDefinition"
      ? []
      : [
          {
            title: ANNOTATE_ACTION_TITLE,
            edits: footnoteAdditionEdits(
              content,
              {
                line: range.start.line,
                character: (content.split(/\r?\n/)[range.start.line] ?? "").length,
              },
              toLspPosition(block.position.end).line,
            ),
          },
        ]
  return [...boxActions(content, range.start.line), ...annotation]
}

const documentLinks: SteeringFormat["documentLinks"] = (content) => {
  const lines = content.split(/\r?\n/)
  return inputs(parseWidgets(content).widgets).flatMap((widget) =>
    widget.kind !== "review-checklist"
      ? []
      : widget.hunks.flatMap((hunk): SteeringLink[] => {
          const character = (lines[hunk.line] ?? "").indexOf(hunk.pointer)
          if (character < 0) return []
          return [
            {
              range: {
                start: { line: hunk.line, character },
                end: { line: hunk.line, character: character + hunk.pointer.length },
              },
              path: hunk.path.replace(/^\.\//, ""),
              line: hunk.start - 1,
            },
          ]
        }),
  )
}

const pointerAt: SteeringFormat["pointerAt"] = (content, position) => {
  const footnote = footnotePointerAt(content, position)
  if (footnote !== undefined) return footnote.pointer
  const link = documentLinks?.(content).find((l) => l.range.start.line === position.line)
  return link === undefined ? undefined : { path: link.path, line: link.line }
}

/** The one steering format: a document of widgets. */
export const widgetFormat: SteeringFormat = {
  sample: SAMPLE,
  validate: (content) => {
    const doc = parseWidgets(content)
    return [...doc.findings, ...answerFindings(doc)]
  },
  outline,
  actions,
  pointerAt,
  documentLinks,
  view,
  annotate,
  apply,
  clearTicks: (content) => content,
}
