import type { List, ListItem, Node, Root, RootContent } from "mdast"
import { blockNodesOfRun } from "./Blocks.js"
import { eolOf } from "./Eol.js"
import {
  footnoteAttachEdits,
  noteLookup,
  openThreadsOf,
  threadFindings,
  threadOutlineNodes,
  threadReplyActions,
} from "./Footnotes.js"
import { headingText, lineRange, parseMarkdown, spanRange, toLspPosition } from "./MarkdownTree.js"
import type {
  SteeringAnnotateResult,
  SteeringFinding,
  SteeringFormat,
  SteeringOutlineNode,
  SteeringView,
  SteeringViewNode,
} from "./SteeringFormat.js"

/** The `# ` heading the findings a judge called noise sit under. */
export const NOISE_HEADING = "Dropped as noise"
/** The label of the one box under each finding. */
export const FIX_BOX = "fix"

const OPEN_GROUP = "Open"

/** One `## ` finding of a finding-gate file. */
export interface FindingEntry {
  readonly title: string
  /** The finding's markdown between its heading and its box. */
  readonly body: string
  /** Under `# Dropped as noise`. */
  readonly noise: boolean
  /** Its box is ticked. */
  readonly fix: boolean
  /** The human's text below the box; `""` when none. */
  readonly guidance: string
  /** How many `fix` boxes it holds; valid only with exactly one. */
  readonly boxes: number
  readonly headingLine: number
}

interface Parsed extends FindingEntry {
  readonly bodyNodes: readonly RootContent[]
  readonly box?: ListItem
  /** The box and the items after it, kept out of the body when its list starts in the body. */
  readonly notBody: ReadonlySet<ListItem>
  /** The guidance's last line, or the box's when there is none. */
  readonly lastLine: number
  readonly endLine: number
}

const MARKER = /\[\^[^\]\s]+\]/g

const isBox = (item: ListItem, content: string): boolean => {
  if (typeof item.checked !== "boolean") return false
  const first = item.children[0]
  if (first?.type !== "paragraph" || first.position === undefined) return false
  const text = content.slice(first.position.start.offset, first.position.end.offset)
  return new RegExp(`^${FIX_BOX}(?![\\w-])`).test(text)
}

const slice = (content: string, node: Node): string =>
  content.slice(node.position!.start.offset, node.position!.end.offset)

const lineOf = (node: Node, end = false): number =>
  toLspPosition(end ? node.position!.end : node.position!.start).line

/** The box item's own text past its label: a formatter may fold a guidance line into it. */
const inlineGuidance = (content: string, item: ListItem): string => {
  const first = item.children[0]!
  const text = content.slice(first.position!.start.offset, item.position!.end.offset)
  return text
    .slice(FIX_BOX.length)
    .replace(/^[\s:—–-]+/, "")
    .trim()
}

interface Split {
  readonly bodyNodes: readonly RootContent[]
  readonly body: string
  readonly notBody: readonly ListItem[]
  readonly guidance: string
  readonly last?: Node
}

const guidanceOf = (parts: readonly string[]): string =>
  parts
    .map((p) => p.replace(MARKER, "").trim())
    .filter((p) => p !== "")
    .join("\n\n")

/** `nodes` split at `box`: the body before it, the guidance after it. */
const splitAtBox = (content: string, nodes: readonly RootContent[], box: ListItem): Split => {
  const at = nodes.findIndex((n) => n.type === "list" && n.children.includes(box))
  const list = nodes[at] as List
  const boxAt = list.children.indexOf(box)
  // A body ending in a list runs on into the box's own list: its items before the box are body.
  const bodyNodes = nodes.slice(0, boxAt > 0 ? at + 1 : at)
  const trailing = list.children.slice(boxAt + 1)
  const after = nodes.slice(at + 1)
  return {
    bodyNodes,
    body: bodyNodes
      .map((n) =>
        n === list
          ? content.slice(n.position!.start.offset, box.position!.start.offset).trimEnd()
          : slice(content, n),
      )
      .join("\n\n"),
    notBody: list.children.slice(boxAt),
    guidance: guidanceOf([
      inlineGuidance(content, box),
      ...[...trailing, ...after].map((n) => slice(content, n)),
    ]),
    last: after.at(-1) ?? trailing.at(-1) ?? box,
  }
}

const entryOf = (
  content: string,
  title: string,
  noise: boolean,
  headingLine: number,
  nodes: readonly RootContent[],
  endLine: number,
): Parsed => {
  const notes = nodes.filter((n) => n.type !== "footnoteDefinition")
  const boxes = notes.flatMap((n) =>
    n.type === "list" ? n.children.filter((i) => isBox(i, content)) : [],
  )
  const box = boxes[0]
  const split: Split =
    box === undefined
      ? {
          bodyNodes: notes,
          body: notes.map((n) => slice(content, n)).join("\n\n"),
          notBody: [],
          guidance: "",
        }
      : splitAtBox(content, notes, box)
  return {
    title,
    body: split.body,
    noise,
    fix: box?.checked === true,
    guidance: split.guidance,
    boxes: boxes.length,
    headingLine,
    bodyNodes: split.bodyNodes,
    ...(box === undefined ? {} : { box }),
    notBody: new Set(split.notBody),
    lastLine: split.last === undefined ? headingLine : lineOf(split.last, true),
    endLine,
  }
}

const parse = (content: string): readonly Parsed[] => {
  const tree: Root = parseMarkdown(content)
  const entries: Parsed[] = []
  let noise = false
  let open: { title: string; line: number; nodes: RootContent[] } | undefined
  const close = (endLine: number): void => {
    if (open !== undefined)
      entries.push(entryOf(content, open.title, noise, open.line, open.nodes, endLine))
    open = undefined
  }
  for (const node of tree.children) {
    if (node.type === "heading" && node.depth <= 2) {
      close(lineOf(node) - 1)
      const text = headingText(content, node, (t) => t.replace(MARKER, ""))
      if (node.depth === 1) noise = text === NOISE_HEADING
      else open = { title: text, line: lineOf(node), nodes: [] }
      continue
    }
    open?.nodes.push(node)
  }
  close(content.split(/\r?\n/).length - 1)
  return entries
}

/** Every `## ` finding in a finding-gate file, in file order. */
export const findingEntries = (content: string): readonly FindingEntry[] =>
  parse(content).map(
    ({ title, body, noise, fix, guidance, boxes, headingLine }): FindingEntry => ({
      title,
      body,
      noise,
      fix,
      guidance,
      boxes,
      headingLine,
    }),
  )

const entryFindings = (content: string): readonly SteeringFinding[] =>
  parse(content).flatMap((e): SteeringFinding[] => {
    if (e.boxes === 0)
      return [
        {
          message: `"${e.title}" has no \`- [ ] ${FIX_BOX}\` box — restore it, ticked to fix the finding or unticked to drop it`,
          line: e.headingLine,
        },
      ]
    if (e.boxes > 1)
      return [
        {
          message: `"${e.title}" has ${e.boxes} \`${FIX_BOX}\` boxes — keep exactly one`,
          line: e.headingLine,
        },
      ]
    if (!e.fix && e.guidance !== "")
      return [
        {
          message: `"${e.title}" has guidance under an unticked box — tick it to fix the finding, or delete the text to drop it`,
          line: lineOf(e.box!),
        },
      ]
    return []
  })

const findingsView = (content: string): SteeringView => {
  const noteAt = noteLookup(content)
  return {
    nodes: parse(content).map((e, index): SteeringViewNode => {
      const note = noteAt(e.headingLine)
      return {
        title: e.title,
        anchor: { kind: "chunk", index },
        group: e.noise ? NOISE_HEADING : OPEN_GROUP,
        ...(e.boxes === 1 ? { checked: e.fix } : {}),
        ...(e.guidance === "" ? {} : { note: e.guidance }),
        ...(note?.thread !== undefined ? { thread: note.thread } : {}),
        body: blockNodesOfRun(content, e.bodyNodes, { skipListItem: (i) => e.notBody.has(i) }),
      }
    }),
  }
}

const findingsOutline = (content: string): readonly SteeringOutlineNode[] => {
  const lines = content.split(/\r?\n/)
  return [
    ...parse(content).map(
      (e): SteeringOutlineNode => ({
        name: e.title,
        detail: e.noise ? "noise" : e.fix ? FIX_BOX : "drop",
        range: spanRange(lines, e.headingLine, Math.max(e.headingLine, e.endLine)),
        selectionRange: lineRange(lines, e.headingLine),
      }),
    ),
    ...threadOutlineNodes(content).map((t) => t.node),
  ]
}

const findingsAnnotate: SteeringFormat["annotate"] = (
  content,
  anchor,
  text,
): SteeringAnnotateResult => {
  const entries = parse(content)
  const lines = content.split(/\r?\n/)
  const resolved = ((): { line: number; blockEndLine: number; key: string } | undefined => {
    if (anchor.kind === "chunk") {
      const e = entries[anchor.index]
      return e && { line: e.headingLine, blockEndLine: e.headingLine, key: `chunk:${anchor.index}` }
    }
    if (anchor.kind !== "paragraph") return undefined
    const block = entries
      .flatMap((e) => e.bodyNodes)
      .find((n) => anchor.line >= lineOf(n) && anchor.line <= lineOf(n, true))
    return (
      block && {
        line: anchor.line,
        blockEndLine: lineOf(block, true),
        key: `paragraph:${anchor.line}`,
      }
    )
  })()
  if (resolved === undefined) return { ok: false, reason: "anchor-not-found" }
  const result = footnoteAttachEdits(
    content,
    { ...resolved, endCharacter: (lines[resolved.line] ?? "").length },
    text,
  )
  return result.ok ? { ok: true, edits: result.edits } : result
}

/** Ticks or unticks a finding's box; `text` replaces its guidance, and unticking drops it. */
// fallow-ignore-next-line complexity
const findingsApply: SteeringFormat["apply"] = (content, anchor, opts): SteeringAnnotateResult => {
  if (anchor.kind !== "chunk") return { ok: false, reason: "anchor-not-found" }
  const e = parse(content)[anchor.index]
  if (e?.box === undefined || e.boxes !== 1) return { ok: false, reason: "anchor-not-found" }
  const fix = opts.checked ?? e.fix
  const guidance = fix ? (opts.text ?? e.guidance).trim() : ""
  if (fix === e.fix && guidance === e.guidance) return { ok: true, edits: [] }
  const lines = content.split(/\r?\n/)
  const eol = eolOf(content)
  const start = lineOf(e.box)
  const box = `${lines[start]!.match(/^\s*[-*+]\s+/)![0]}[${fix ? "x" : " "}] ${FIX_BOX}`
  const text = guidance === "" ? box : `${box}${eol}${eol}${guidance.split(/\r?\n/).join(eol)}`
  return {
    ok: true,
    edits: [
      {
        range: { start: { line: start, character: 0 }, end: lineRange(lines, e.lastLine).end },
        newText: text,
      },
    ],
  }
}

const FINDINGS_SAMPLE = `# Quality

## A finding a lens wrote[^nafind1]

[^nafind1]:
    Attached via the phone UI, this note shows a comment on a finding with a
    \`multi word code span\` that runs past eighty characters in total length.

What the lens found, and where.

- [x] fix

Fix it the simple way.

# Dropped as noise

## A finding the judge called noise

Why the judge dropped it.

- [ ] fix
`

/** The finding gate's file: one `## ` finding each, with one `fix` box and optional guidance below it. */
export const findingsDescriptor: SteeringFormat = {
  sample: FINDINGS_SAMPLE,
  validate: (content) => [...entryFindings(content), ...threadFindings(content)],
  outline: findingsOutline,
  actions: (content, range) => threadReplyActions(content, range.start),
  view: findingsView,
  annotate: findingsAnnotate,
  apply: findingsApply,
  // Its ticks are the human's decisions, never read-progress.
  clearTicks: (content) => content,
  openThreads: openThreadsOf,
}
