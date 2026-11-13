import type { SteeringFinding } from "./SteeringFormat.js"
import {
  isCustomAnswered,
  WIDGET_EMOJI,
  type Widget,
  type WidgetDocument,
  type WidgetKind,
} from "./Widgets.js"

/** One changed post-image range of the review base diff, 1-based and inclusive. */
export interface ChangedRange {
  readonly path: string
  readonly start: number
  readonly end: number
}

export interface AgentRuleOptions {
  /** The widget kinds the step allows; static content is always allowed. */
  readonly allow?: readonly WidgetKind[] | undefined
  /** The review base diff. Without it, hunk pointers are not checked against it. */
  readonly diff?: readonly ChangedRange[] | undefined
  /** Every range of `diff` must be listed by some hunk pointer. */
  readonly coverage?: boolean | undefined
}

const normalizePath = (path: string): string => path.replace(/^\.\//, "")

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
  a.start <= b.end && b.start <= a.end

/** Whether the human annotated the file; an annotation lifts every answer rule. */
export const isAnnotated = (doc: WidgetDocument): boolean =>
  doc.annotations.length > 0 || doc.widgets.some((w) => w.annotations.length > 0)

/** The widgets a human still has to answer before a gate lands: a single select with no answer, a review checklist with unticked hunks. */
export const unansweredWidgets = (widgets: readonly Widget[]): readonly Widget[] =>
  widgets.filter((w) => {
    if (w.kind === "single-select")
      return (
        !w.options.some((o) => o.checked) && !(w.custom !== undefined && isCustomAnswered(w.custom))
      )
    if (w.kind === "review-checklist") return w.hunks.some((h) => !h.checked)
    return false
  })

/** What keeps a human from landing: unanswered required widgets, unless the file is annotated. */
export const answerFindings = (doc: WidgetDocument): readonly SteeringFinding[] => {
  if (isAnnotated(doc)) return []
  return unansweredWidgets(doc.widgets).map((w) => {
    if (w.kind === "review-checklist") {
      const open = w.hunks.filter((h) => !h.checked).length
      return {
        line: w.line,
        message: `"${w.title}": tick every hunk (${open} unticked), or add an annotation to send it back`,
      }
    }
    return {
      line: w.line,
      message: `"${w.title}": pick one option${w.kind === "single-select" && w.custom !== undefined ? " or write a ✏️ answer" : ""}, or add an annotation to send it back`,
    }
  })
}

const annotationFindings = (doc: WidgetDocument): SteeringFinding[] => {
  const defined = new Set(doc.annotations.map((a) => a.label))
  return [
    ...doc.annotations.map((annotation) => ({
      line: annotation.line,
      message: `annotation [^${annotation.label}] is still in the file: work what it says into the document, then remove the marker and its note`,
    })),
    ...doc.widgets.flatMap((widget) =>
      widget.annotations
        .filter((label) => !defined.has(label))
        .map((label) => ({
          line: widget.line,
          message: `annotation marker [^${label}] is still in the file: remove it`,
        })),
    ),
  ]
}

const allowFindings = (doc: WidgetDocument, allow: readonly WidgetKind[]): SteeringFinding[] => {
  const allowed = allow.filter((k) => k !== "static").join(", ") || "static content only"
  return doc.widgets.flatMap((widget) =>
    widget.kind === "static" || allow.includes(widget.kind)
      ? []
      : [
          {
            line: widget.line,
            message: `"${widget.title}": this step does not take a ${WIDGET_EMOJI[widget.kind]} ${widget.kind} widget; use ${allowed}`,
          },
        ],
  )
}

const diffFindings = (
  doc: WidgetDocument,
  diff: readonly ChangedRange[],
  coverage: boolean,
): SteeringFinding[] => {
  const hunks = doc.widgets.flatMap((w) => (w.kind === "review-checklist" ? w.hunks : []))
  const listed = (range: ChangedRange): boolean =>
    hunks.some((hunk) => normalizePath(hunk.path) === range.path && overlaps(range, hunk))
  const outside = hunks
    .filter(
      (hunk) =>
        !diff.some((range) => range.path === normalizePath(hunk.path) && overlaps(range, hunk)),
    )
    .map((hunk) => ({
      line: hunk.line,
      message: `${hunk.pointer} is not part of the change under review: point at lines the diff changes`,
    }))
  const unlisted = coverage
    ? diff
        .filter((range) => !listed(range))
        .map((range) => ({
          message: `./${range.path}#${range.start}-${range.end} is changed but no 🔍 widget lists it`,
        }))
    : []
  return [...outside, ...unlisted]
}

/** What a steering step's turn must fix before the file reaches the human. Structural findings come from `parseWidgets`. */
export const agentFindings = (
  doc: WidgetDocument,
  options: AgentRuleOptions = {},
): readonly SteeringFinding[] =>
  [
    ...annotationFindings(doc),
    ...(options.allow === undefined ? [] : allowFindings(doc, options.allow)),
    ...(options.diff === undefined
      ? []
      : diffFindings(doc, options.diff, options.coverage === true)),
  ].sort(
    (a: SteeringFinding, b: SteeringFinding) =>
      (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER),
  )
