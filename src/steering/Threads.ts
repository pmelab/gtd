import type { List, ListItem, Root } from "mdast"
import { sourceText, spanRange, toLspPosition } from "./MarkdownTree.js"
import type { SteeringFinding } from "./SteeringFormat.js"

export interface ThreadMarker {
  readonly name: string
  readonly line: number
  readonly character: number
  readonly endCharacter: number
}

export interface ThreadEntry {
  readonly author: "me" | "agent"
  readonly text: string
  readonly line: number
  /** The entry's own last line — its last block's, never the list item's span (see `itemText`). */
  readonly endLine: number
  /** Column of the entry's `-` bullet. */
  readonly column: number
}

/** `waitingOn: "human"` means the last entry is the agent's — the thread is OPEN. */
export interface Thread {
  readonly name: string
  readonly line: number
  readonly endLine: number
  readonly markers: readonly ThreadMarker[]
  readonly entries: readonly ThreadEntry[]
  readonly waitingOn: "human" | "agent"
}

const PREFIX_RE = /^(H|A):\s*/

interface Def {
  readonly node: {
    readonly label?: string | undefined
    readonly identifier?: string | undefined
    readonly children: readonly unknown[]
    readonly position?: unknown
  }
}

const lineOf = (node: { readonly position?: unknown }, which: "start" | "end"): number =>
  toLspPosition((node.position as Record<"start" | "end", { line: number; column: number }>)[which])
    .line

/** The item's own blocks joined — never the item node's span, which can run past its last line into the next bullet's marker. */
const itemText = (content: string, item: ListItem): string =>
  item.children
    .map((child) => sourceText(content, child))
    .join(" ")
    .trim()

const prefixOf = (content: string, item: ListItem): RegExpExecArray | null =>
  PREFIX_RE.exec(itemText(content, item))

/** A thread is a definition whose body OPENS with a list whose first item carries a prefix — anything else stays a one-shot footnote. */
const isThreadBody = (content: string, children: readonly unknown[]): List | undefined => {
  const first = children[0] as { type: string } | undefined
  if (first?.type !== "list") return undefined
  const list = first as List
  const item = list.children[0]
  return item && prefixOf(content, item) ? list : undefined
}

const foldName = (name: string): string => name.toLowerCase()

type Report = (message: string, from: number, to: number) => void

/** One list item's entry, reporting any syntax problem; `previous` is the author before it. */
const entryOf = (
  content: string,
  item: ListItem,
  previous: ThreadEntry["author"] | undefined,
  report: Report,
): ThreadEntry | undefined => {
  const start = lineOf(item, "start")
  const end = lineOf(item, "end")
  const match = prefixOf(content, item)
  if (!match) {
    report(`an entry must start with "H:" or "A:"`, start, end)
    return undefined
  }
  const author = match[1] === "H" ? "me" : "agent"
  const text = itemText(content, item).slice(match[0].length).trim()
  if (text === "") report(`empty "${match[1]}:" entry — write your own words there`, start, end)
  if (previous === undefined && author === "agent") {
    report(`the agent never starts a thread — the first entry must be "H:"`, start, end)
  } else if (previous === author) {
    report(`two consecutive "${match[1]}:" entries — entries must alternate`, start, end)
  }
  const last = item.children[item.children.length - 1]
  return {
    author,
    text,
    line: start,
    endLine: last ? lineOf(last, "end") : end,
    column: toLspPosition(item.position!.start).character,
  }
}

const threadOf = (
  content: string,
  def: Def["node"],
  list: List,
  markers: readonly ThreadMarker[],
  report: Report,
): Thread => {
  const name = def.label ?? def.identifier ?? ""
  const entries: ThreadEntry[] = []
  let previous: ThreadEntry["author"] | undefined
  for (const item of list.children) {
    const entry = entryOf(content, item, previous, report)
    if (!entry) continue
    previous = entry.author
    entries.push(entry)
  }
  for (const extra of def.children.slice(1) as { position?: unknown }[]) {
    report(
      `only one list of "H:"/"A:" entries may make up the body`,
      lineOf(extra, "start"),
      lineOf(extra, "end"),
    )
  }
  return {
    name,
    line: lineOf(def, "start"),
    endLine: lineOf(def, "end"),
    markers: markers.filter((m) => foldName(m.name) === foldName(name)),
    entries,
    waitingOn: entries[entries.length - 1]?.author === "agent" ? "human" : "agent",
  }
}

/** Threads and their syntax findings off ONE tree walk; `markers` come from the caller so this module never re-parses footnotes. */
export const collectThreads = (
  content: string,
  tree: Root,
  markers: readonly ThreadMarker[],
): { readonly threads: readonly Thread[]; readonly findings: readonly SteeringFinding[] } => {
  const lines = content.split(/\r?\n/)
  const threads: Thread[] = []
  const findings: SteeringFinding[] = []
  const walk = (node: { type: string; children?: unknown }): void => {
    const def = node.type === "footnoteDefinition" ? (node as unknown as Def["node"]) : undefined
    const list = def && isThreadBody(content, def.children)
    if (def && list) {
      const name = def.label ?? def.identifier ?? ""
      const report: Report = (message, from, to) => {
        findings.push({
          message: `Footnote thread "[^${name}]": ${message}`,
          line: from,
          range: spanRange(lines, from, to),
        })
      }
      threads.push(threadOf(content, def, list, markers, report))
    }
    const children = node.children as readonly (typeof node)[] | undefined
    if (children) children.forEach(walk)
  }
  walk(tree)
  return { threads, findings }
}
