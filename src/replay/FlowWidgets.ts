import type { Widget as FlowWidget } from "../flows/internal.js"
import { parseWidgets, unansweredWidgets, type Widget } from "../steering/internal.js"

const flowWidget = (widget: Widget, unanswered: ReadonlySet<Widget>): FlowWidget => {
  const base = {
    title: widget.title,
    line: widget.line + 1,
    annotations: widget.annotations,
    answered: !unanswered.has(widget),
  }
  switch (widget.kind) {
    case "static":
      return { ...base, kind: "static", markdown: widget.markdown }
    case "boolean":
      return {
        ...base,
        kind: "boolean",
        description: widget.description,
        label: widget.label,
        checked: widget.checked,
      }
    case "review-checklist":
      return {
        ...base,
        kind: "review-checklist",
        description: widget.description,
        hunks: widget.hunks.map(({ line: _, ...hunk }) => hunk),
      }
    default:
      return {
        ...base,
        kind: widget.kind,
        description: widget.description,
        options: widget.options.map(({ label, checked }) => ({ label, checked })),
        ...(widget.custom === undefined
          ? {}
          : { custom: { text: widget.custom.text, checked: widget.custom.checked } }),
      }
  }
}

/** A steering file's widgets as flow code reads them: 1-based lines, each with whether it is answered. */
export const flowWidgets = (text: string): readonly FlowWidget[] => {
  const { widgets } = parseWidgets(text)
  const unanswered = new Set(unansweredWidgets(widgets))
  return widgets.map((widget) => flowWidget(widget, unanswered))
}
