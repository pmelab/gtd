import type {
  FootnoteDefinition,
  FootnoteReference,
  Heading,
  List,
  ListItem,
  Node,
  Root,
  RootContent,
} from "mdast"
import { headingText, parseMarkdown, sourceText } from "./MarkdownTree.js"
import type { SteeringFinding } from "./SteeringFormat.js"

export type WidgetKind =
  | "review-checklist"
  | "single-select"
  | "multi-select"
  | "boolean"
  | "static"

export type InputWidgetKind = Exclude<WidgetKind, "static">

/** The emoji that starts each input widget's heading. The second form of ☑️ and ✏️ omits the variation selector, as editors often do. */
export const WIDGET_EMOJI: Readonly<Record<InputWidgetKind, string>> = {
  "review-checklist": "🔍",
  "single-select": "🔘",
  "multi-select": "☑️",
  boolean: "❔",
}

export const CUSTOM_ANSWER_EMOJI = "✏️"

const KIND_BY_EMOJI: readonly (readonly [string, InputWidgetKind])[] = [
  ["🔍", "review-checklist"],
  ["🔘", "single-select"],
  ["☑️", "multi-select"],
  ["☑", "multi-select"],
  ["❔", "boolean"],
]

const CUSTOM_RE = /^✏️?/u

/** Every line here is 0-based, as in `SteeringFinding`. */
export interface WidgetOption {
  readonly label: string
  readonly checked: boolean
  readonly line: number
}

export interface CustomAnswer {
  readonly text: string
  readonly checked: boolean
  readonly line: number
}

export interface Hunk {
  /** The pointer as written: `./path#a-b` or `./path#a`. */
  readonly pointer: string
  readonly path: string
  readonly start: number
  readonly end: number
  /** Prose after the pointer, without its separator. */
  readonly note: string
  readonly checked: boolean
  readonly line: number
}

interface WidgetCommon {
  /** Heading text without the emoji; for static content, its leading heading's text or "". */
  readonly title: string
  readonly line: number
  readonly endLine: number
  /** Labels of the annotations whose markers sit inside this widget. */
  readonly annotations: readonly string[]
}

interface InputCommon extends WidgetCommon {
  readonly depth: number
  /** Markdown between the heading and the input. */
  readonly description: string
}

export interface SingleSelectWidget extends InputCommon {
  readonly kind: "single-select"
  readonly options: readonly WidgetOption[]
  readonly custom?: CustomAnswer
}

export interface MultiSelectWidget extends InputCommon {
  readonly kind: "multi-select"
  readonly options: readonly WidgetOption[]
  readonly custom?: CustomAnswer
}

export interface BooleanWidget extends InputCommon {
  readonly kind: "boolean"
  readonly label: string
  readonly checked: boolean
}

export interface ReviewChecklistWidget extends InputCommon {
  readonly kind: "review-checklist"
  readonly hunks: readonly Hunk[]
}

export interface StaticWidget extends WidgetCommon {
  readonly kind: "static"
  readonly markdown: string
}

export type InputWidget =
  | SingleSelectWidget
  | MultiSelectWidget
  | BooleanWidget
  | ReviewChecklistWidget

export type Widget = InputWidget | StaticWidget

export interface Annotation {
  readonly label: string
  readonly text: string
  readonly line: number
}

export interface WidgetDocument {
  readonly widgets: readonly Widget[]
  readonly annotations: readonly Annotation[]
  readonly findings: readonly SteeringFinding[]
}

const POINTER_RE = /^(\.\/\S+?)#(\d+)(?:-(\d+))?(?=\s|$)/
const NOTE_SEPARATOR_RE = /^\s*[—–-]*\s*/

const line0 = (node: Node): number => (node.position?.start.line ?? 1) - 1
const endLine0 = (node: Node): number => (node.position?.end.line ?? 1) - 1

export const widgetKindOf = (
  content: string,
  heading: Heading,
): { kind: InputWidgetKind; title: string } | undefined => {
  const text = headingText(content, heading)
  for (const [emoji, kind] of KIND_BY_EMOJI) {
    if (text.startsWith(emoji))
      return { kind, title: text.slice(emoji.length).replace(/^️/u, "").trim() }
  }
  return undefined
}

const isTaskList = (node: RootContent): node is List =>
  node.type === "list" && node.children.some((item) => typeof item.checked === "boolean")

/** An item's own text: its first paragraph, as written. */
const itemText = (content: string, item: ListItem): string => {
  const first = item.children[0]
  return first?.type === "paragraph"
    ? sourceText(content, first)
        .replace(/^\[[ xX]\]\s*/, "")
        .trim()
    : ""
}

const footnoteLabels = (node: Node): string[] => {
  const labels: string[] = []
  const walk = (n: Node): void => {
    if (n.type === "footnoteReference") {
      const ref = n as FootnoteReference
      labels.push(ref.label ?? ref.identifier)
    }
    for (const child of (n as { children?: Node[] }).children ?? []) walk(child)
  }
  walk(node)
  return labels
}

/** The source from the first node's start to the last node's end, as written. */
const rawSpan = (content: string, nodes: readonly Node[]): string => {
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (first?.position === undefined || last?.position === undefined) return ""
  return content.slice(first.position.start.offset, last.position.end.offset)
}

const finding = (line: number, message: string): SteeringFinding => ({ line, message })

interface InputParse {
  readonly widget: InputWidget
  readonly findings: readonly SteeringFinding[]
}

const parseInput = (
  content: string,
  heading: Heading,
  kind: InputWidgetKind,
  title: string,
  description: readonly RootContent[],
  list: List,
): InputParse => {
  const findings: SteeringFinding[] = []
  // A plain list right before the checkboxes merges with them into one list;
  // its leading plain items are still description.
  const firstTask = list.children.findIndex((item) => typeof item.checked === "boolean")
  const items = list.children.slice(firstTask)
  const leading = list.children.slice(0, firstTask)
  const common = {
    title,
    depth: heading.depth,
    line: line0(heading),
    endLine: endLine0(list),
    description: [rawSpan(content, description), rawSpan(content, leading)]
      .filter((part) => part !== "")
      .join("\n\n"),
    annotations: [heading, ...description, list].flatMap(footnoteLabels),
  }
  for (const item of items) {
    if (typeof item.checked !== "boolean")
      findings.push(
        finding(
          line0(item),
          `"${title}": every item of a widget's list must be a checkbox (\`- [ ] …\`)`,
        ),
      )
  }
  const tasks = items.filter((item) => typeof item.checked === "boolean")

  if (kind === "review-checklist") {
    const hunks: Hunk[] = []
    for (const item of tasks) {
      const text = itemText(content, item)
      const match = POINTER_RE.exec(text)
      if (match === null) {
        findings.push(
          finding(
            line0(item),
            `"${title}": a review checklist item must start with a hunk pointer like \`./path/file.ts#10-20\``,
          ),
        )
        continue
      }
      const start = Number(match[2])
      const end = match[3] === undefined ? start : Number(match[3])
      if (end < start)
        findings.push(
          finding(line0(item), `"${title}": hunk range ${match[0]} ends before it starts`),
        )
      hunks.push({
        pointer: match[0],
        path: match[1] ?? "",
        start,
        end,
        note: text.slice(match[0].length).replace(NOTE_SEPARATOR_RE, ""),
        checked: item.checked === true,
        line: line0(item),
      })
    }
    return { widget: { ...common, kind, hunks }, findings }
  }

  if (kind === "boolean") {
    if (tasks.length !== 1)
      findings.push(
        finding(
          common.line,
          `"${title}": a boolean widget has exactly one checkbox, found ${tasks.length}`,
        ),
      )
    const item = tasks[0]
    const label = item === undefined ? "" : itemText(content, item)
    if (CUSTOM_RE.test(label) && label.startsWith("✏"))
      findings.push(finding(common.line, `"${title}": a boolean widget has no custom answer`))
    return { widget: { ...common, kind, label, checked: item?.checked === true }, findings }
  }

  const options: WidgetOption[] = []
  let custom: CustomAnswer | undefined
  tasks.forEach((item, index) => {
    const text = itemText(content, item)
    if (text.startsWith("✏")) {
      if (index !== tasks.length - 1)
        findings.push(
          finding(line0(item), `"${title}": the ✏️ custom answer must be the last item`),
        )
      custom = {
        text: text.replace(CUSTOM_RE, "").trim(),
        checked: item.checked === true,
        line: line0(item),
      }
      return
    }
    options.push({ label: text, checked: item.checked === true, line: line0(item) })
  })
  if (options.length === 0)
    findings.push(finding(common.line, `"${title}": a select needs at least one option`))
  if (kind === "single-select") {
    const picked =
      options.filter((o) => o.checked).length +
      (custom !== undefined && isCustomAnswered(custom) ? 1 : 0)
    if (picked > 1)
      findings.push(
        finding(common.line, `"${title}": a single select takes one answer, ${picked} are given`),
      )
    return {
      widget: { ...common, kind, options, ...(custom === undefined ? {} : { custom }) },
      findings,
    }
  }
  return {
    widget: { ...common, kind, options, ...(custom === undefined ? {} : { custom }) },
    findings,
  }
}

export const isCustomAnswered = (custom: CustomAnswer): boolean =>
  custom.checked || custom.text !== ""

const annotationOf = (content: string, node: FootnoteDefinition): Annotation => ({
  label: node.label ?? node.identifier,
  text: rawSpan(content, node.children),
  line: line0(node),
})

/** Reads a steering file as widgets. Never throws: what does not parse becomes a finding. */
export const parseWidgets = (content: string): WidgetDocument => {
  const tree: Root = parseMarkdown(content)
  const widgets: Widget[] = []
  const findings: SteeringFinding[] = []
  const annotations: Annotation[] = []
  let staticRun: RootContent[] = []

  const flushStatic = (): void => {
    const first = staticRun[0]
    const last = staticRun[staticRun.length - 1]
    if (first === undefined || last === undefined) return
    widgets.push({
      kind: "static",
      title: first.type === "heading" ? headingText(content, first) : "",
      line: line0(first),
      endLine: endLine0(last),
      markdown: rawSpan(content, staticRun),
      annotations: staticRun.flatMap(footnoteLabels),
    })
    staticRun = []
  }

  const nodes = tree.children
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i] as RootContent
    if (node.type === "footnoteDefinition") {
      annotations.push(annotationOf(content, node))
      i += 1
      continue
    }
    const marked = node.type === "heading" ? widgetKindOf(content, node) : undefined
    if (node.type !== "heading" || marked === undefined) {
      staticRun.push(node)
      i += 1
      continue
    }
    flushStatic()
    const description: RootContent[] = []
    let j = i + 1
    let list: List | undefined
    while (j < nodes.length) {
      const next = nodes[j] as RootContent
      if (next.type === "heading") break
      if (isTaskList(next)) {
        list = next
        break
      }
      if (next.type !== "footnoteDefinition") description.push(next)
      else annotations.push(annotationOf(content, next))
      j += 1
    }
    if (list === undefined) {
      findings.push(
        finding(
          line0(node),
          `"${marked.title}": a ${WIDGET_EMOJI[marked.kind]} widget needs its checkbox list before the next heading`,
        ),
      )
      staticRun.push(node, ...description)
      i = j
      continue
    }
    const parsed = parseInput(content, node, marked.kind, marked.title, description, list)
    widgets.push(parsed.widget)
    findings.push(...parsed.findings)
    i = j + 1
  }
  flushStatic()

  return { widgets, annotations, findings: findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)) }
}
