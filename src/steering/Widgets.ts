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
  /** The checkbox's own line. */
  readonly itemLine: number
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

const widgetKindOf = (
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

type Findings = SteeringFinding[]

interface InputContext {
  readonly content: string
  readonly title: string
  readonly line: number
  readonly findings: Findings
}

const isTask = (item: ListItem): boolean => typeof item.checked === "boolean"

const hunkOf = (ctx: InputContext, item: ListItem): Hunk | undefined => {
  const text = itemText(ctx.content, item)
  const match = POINTER_RE.exec(text)
  if (match === null) {
    ctx.findings.push(
      finding(
        line0(item),
        `"${ctx.title}": a review checklist item must start with a hunk pointer like \`./path/file.ts#10-20\``,
      ),
    )
    return undefined
  }
  const start = Number(match[2])
  const end = match[3] === undefined ? start : Number(match[3])
  if (end < start)
    ctx.findings.push(
      finding(line0(item), `"${ctx.title}": hunk range ${match[0]} ends before it starts`),
    )
  return {
    pointer: match[0],
    path: match[1] ?? "",
    start,
    end,
    note: text.slice(match[0].length).replace(NOTE_SEPARATOR_RE, ""),
    checked: item.checked === true,
    line: line0(item),
  }
}

const booleanOf = (
  ctx: InputContext,
  tasks: readonly ListItem[],
): { label: string; checked: boolean; itemLine: number } => {
  if (tasks.length !== 1)
    ctx.findings.push(
      finding(
        ctx.line,
        `"${ctx.title}": a boolean widget has exactly one checkbox, found ${tasks.length}`,
      ),
    )
  const item = tasks[0]
  const label = item === undefined ? "" : itemText(ctx.content, item)
  if (label.startsWith("✏"))
    ctx.findings.push(finding(ctx.line, `"${ctx.title}": a boolean widget has no custom answer`))
  return {
    label,
    checked: item?.checked === true,
    itemLine: item === undefined ? ctx.line : line0(item),
  }
}

const choicesOf = (
  ctx: InputContext,
  tasks: readonly ListItem[],
): { options: WidgetOption[]; custom?: CustomAnswer } => {
  const options: WidgetOption[] = []
  let custom: CustomAnswer | undefined
  tasks.forEach((item, index) => {
    const text = itemText(ctx.content, item)
    const checked = item.checked === true
    if (!text.startsWith("✏")) {
      options.push({ label: text, checked, line: line0(item) })
      return
    }
    if (index !== tasks.length - 1)
      ctx.findings.push(
        finding(line0(item), `"${ctx.title}": the ✏️ custom answer must be the last item`),
      )
    custom = { text: text.replace(CUSTOM_RE, "").trim(), checked, line: line0(item) }
  })
  if (options.length === 0)
    ctx.findings.push(finding(ctx.line, `"${ctx.title}": a select needs at least one option`))
  return custom === undefined ? { options } : { options, custom }
}

const pickedCount = (choices: {
  options: readonly WidgetOption[]
  custom?: CustomAnswer
}): number =>
  choices.options.filter((o) => o.checked).length +
  (choices.custom !== undefined && isCustomAnswered(choices.custom) ? 1 : 0)

interface InputParts {
  readonly heading: Heading
  readonly kind: InputWidgetKind
  readonly title: string
  readonly description: readonly RootContent[]
  readonly list: List
}

const parseInput = (content: string, parts: InputParts, findings: Findings): InputWidget => {
  const { heading, kind, title, description, list } = parts
  // A plain list right before the checkboxes merges with them into one list;
  // its leading plain items are still description.
  const firstTask = list.children.findIndex(isTask)
  const items = list.children.slice(firstTask)
  const common = {
    title,
    depth: heading.depth,
    line: line0(heading),
    endLine: endLine0(list),
    description: [
      rawSpan(content, description),
      rawSpan(content, list.children.slice(0, firstTask)),
    ]
      .filter((part) => part !== "")
      .join("\n\n"),
    annotations: [heading, ...description, list].flatMap(footnoteLabels),
  }
  const ctx: InputContext = { content, title, line: common.line, findings }
  for (const item of items.filter((item) => !isTask(item)))
    findings.push(
      finding(
        line0(item),
        `"${title}": every item of a widget's list must be a checkbox (\`- [ ] …\`)`,
      ),
    )
  const tasks = items.filter(isTask)
  if (kind === "review-checklist") {
    const hunks = tasks.flatMap((item) => hunkOf(ctx, item) ?? [])
    return { ...common, kind, hunks }
  }
  if (kind === "boolean") return { ...common, kind, ...booleanOf(ctx, tasks) }
  const choices = choicesOf(ctx, tasks)
  if (kind === "multi-select") return { ...common, kind, ...choices }
  const picked = pickedCount(choices)
  if (picked > 1)
    findings.push(
      finding(common.line, `"${title}": a single select takes one answer, ${picked} are given`),
    )
  return { ...common, kind, ...choices }
}

export const isCustomAnswered = (custom: CustomAnswer): boolean =>
  custom.checked || custom.text !== ""

const annotationOf = (content: string, node: FootnoteDefinition): Annotation => ({
  label: node.label ?? node.identifier,
  text: rawSpan(content, node.children),
  line: line0(node),
})

const staticOf = (content: string, run: readonly RootContent[]): StaticWidget | undefined => {
  const first = run[0]
  const last = run[run.length - 1]
  if (first === undefined || last === undefined) return undefined
  return {
    kind: "static",
    title: first.type === "heading" ? headingText(content, first) : "",
    line: line0(first),
    endLine: endLine0(last),
    markdown: rawSpan(content, run),
    annotations: run.flatMap(footnoteLabels),
  }
}

/** The nodes after an input heading up to its checkbox list, and that list; no list when a heading or the end comes first. */
const inputBody = (
  nodes: readonly RootContent[],
  from: number,
): { description: RootContent[]; list?: List; next: number } => {
  const description: RootContent[] = []
  for (let j = from; j < nodes.length; j += 1) {
    const node = nodes[j] as RootContent
    if (node.type === "heading") return { description, next: j }
    if (isTaskList(node)) return { description, list: node, next: j + 1 }
    description.push(node)
  }
  return { description, next: nodes.length }
}

/** Reads a steering file as widgets. Never throws: what does not parse becomes a finding. */
export const parseWidgets = (content: string): WidgetDocument => {
  const tree: Root = parseMarkdown(content)
  const annotations = tree.children
    .filter((node): node is FootnoteDefinition => node.type === "footnoteDefinition")
    .map((node) => annotationOf(content, node))
  const nodes = tree.children.filter((node) => node.type !== "footnoteDefinition")
  const widgets: Widget[] = []
  const findings: Findings = []
  let run: RootContent[] = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i] as RootContent
    const marked = node.type === "heading" ? widgetKindOf(content, node) : undefined
    if (node.type !== "heading" || marked === undefined) {
      run.push(node)
      i += 1
      continue
    }
    const body = inputBody(nodes, i + 1)
    i = body.next
    if (body.list === undefined) {
      findings.push(
        finding(
          line0(node),
          `"${marked.title}": a ${WIDGET_EMOJI[marked.kind]} widget needs its checkbox list before the next heading`,
        ),
      )
      run.push(node, ...body.description)
      continue
    }
    const before = staticOf(content, run)
    if (before !== undefined) widgets.push(before)
    run = []
    widgets.push(
      parseInput(
        content,
        { heading: node, ...marked, description: body.description, list: body.list },
        findings,
      ),
    )
  }
  const after = staticOf(content, run)
  if (after !== undefined) widgets.push(after)
  return { widgets, annotations, findings: findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)) }
}
