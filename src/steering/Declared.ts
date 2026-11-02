// Formats a workflow declares with `listFormat`/`sectionFormat`. Every rule
// here applies to declared formats only: the built-in `qa`/`review`/`findings`
// formats are a replay contract and never read through this walker.
import { openThreadsOf, threadFindings } from "./Footnotes.js"
import { freeFormFormat } from "./freeform.js"
import type { SteeringFinding, SteeringFormat } from "./SteeringFormat.js"

export type ListMarker = "-" | "*" | "+" | "1."

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface ListFormatSpec {
  /** The mode name a step reports and `gtd check` prints — lowercase letters, digits and `-`. */
  readonly name: string
  /** The heading the list lives under. Absent: the whole document is the list. */
  readonly section?: {
    /** A string matches the heading text case-insensitively; a RegExp needs `example`. */
    readonly title: string | RegExp
    /** The heading text `instructions` and `sample` show for a RegExp `title`. */
    readonly example?: string
    readonly level: HeadingLevel
    /** Default true: a document without the section is a problem. */
    readonly required?: boolean
  }
  /** Items start with an ID, then `separator`, then the text: parsed into `{ id, text }`. */
  readonly item?: {
    readonly id: RegExp
    readonly separator: string
    /** An ID `id` matches, shown by `instructions` and `sample`. */
    readonly example: string
  }
  /** Default `["-"]`. `"1."` stands for any `1.`/`1)` numbered item. */
  readonly markers?: readonly ListMarker[]
  /** `"join"` (default): an indented continuation line joins its item. `"forbid"`: one line per item. */
  readonly wrap?: "join" | "forbid"
  /** `"forbid"` (default), `"strip"` (read and drop `[ ]`/`[x]`), or `"require"`. */
  readonly checkbox?: "forbid" | "strip" | "require"
  readonly ids?: { readonly unique?: boolean }
}

export interface SectionFormatSpec {
  readonly name: string
  /** The heading level every section uses. A shallower heading is a problem; deeper ones belong to a section's body. */
  readonly level: HeadingLevel
  /** `"unique"`: two sections may not share a title. Default `"any"`. */
  readonly title?: "unique" | "any"
}

export interface ListItem {
  /** 0-based line of the item's marker. */
  readonly line: number
  readonly text: string
  /** Set when the format declares `item.id`. */
  readonly id?: string
  /** Set when the format reads checkboxes (`"strip"`/`"require"`). */
  readonly checked?: boolean
}

export interface Section {
  readonly line: number
  readonly title: string
  /** The section's text below its heading, trimmed. */
  readonly body: string
}

interface DeclaredFormat<Parsed> extends SteeringFormat {
  readonly name: string
  /** JSON the engine hands `gtd check --spec`, so a validation script needs no workflow loaded. */
  readonly spec: string
  /** Prose describing the format, for an agent's prompt. */
  readonly instructions: string
  readonly parse: (content: string) => Parsed & { readonly problems: readonly SteeringFinding[] }
}

export type ListFormat = DeclaredFormat<{ readonly items: readonly ListItem[] }>
export type SectionFormat = DeclaredFormat<{ readonly sections: readonly Section[] }>

// --- the shared line walker -------------------------------------------------

const FENCE_RE = /^( *)(`{3,}|~{3,})/
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const ITEM_RE = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/
const CHECKBOX_RE = /^\[([ xX])\](?:[ \t]+|$)/

interface Line {
  readonly index: number
  readonly text: string
  /** Inside a fenced code block, fence lines included. */
  readonly fenced: boolean
  readonly fenceIndent?: number
  /** The line that opens a fence. */
  readonly opens?: boolean
}

interface Walked {
  readonly lines: readonly Line[]
  readonly problems: readonly SteeringFinding[]
}

/** Marks fenced lines; an unclosed fence is a problem rather than swallowing the rest of the document. */
const walk = (content: string): Walked => {
  const raw = content.split(/\r?\n/)
  const lines: Line[] = []
  const problems: SteeringFinding[] = []
  let open:
    | {
        readonly char: string
        readonly length: number
        readonly line: number
        readonly indent: number
      }
    | undefined
  for (const [index, text] of raw.entries()) {
    const fence = FENCE_RE.exec(text)
    if (open === undefined) {
      if (fence !== null) {
        open = {
          char: fence[2]![0]!,
          length: fence[2]!.length,
          line: index,
          indent: fence[1]!.length,
        }
        lines.push({ index, text, fenced: true, fenceIndent: open.indent, opens: true })
      } else lines.push({ index, text, fenced: false })
      continue
    }
    lines.push({ index, text, fenced: true, fenceIndent: open.indent })
    const closes =
      fence !== null &&
      fence[2]![0] === open.char &&
      fence[2]!.length >= open.length &&
      text.slice(fence[0].length).trim() === ""
    if (closes) open = undefined
  }
  if (open !== undefined) problems.push({ line: open.line, message: "code fence is never closed" })
  return { lines, problems }
}

interface Heading {
  readonly line: number
  readonly level: number
  readonly title: string
}

const headingOf = (line: Line): Heading | undefined => {
  if (line.fenced) return undefined
  const match = HEADING_RE.exec(line.text)
  return match === null
    ? undefined
    : { line: line.index, level: match[1]!.length, title: (match[2] ?? "").trim() }
}

const indentOf = (text: string): number => /^ */.exec(text)![0].length

// --- listFormat --------------------------------------------------------------

const markerKind = (marker: string): ListMarker =>
  marker === "-" || marker === "*" || marker === "+" ? marker : "1."

const markerList = (markers: readonly ListMarker[]): string =>
  markers.map((m) => `\`${m}\``).join(" or ")

const titleMatches = (spec: NonNullable<ListFormatSpec["section"]>, title: string): boolean =>
  typeof spec.title === "string"
    ? spec.title.trim().toLowerCase() === title.toLowerCase()
    : spec.title.test(title)

const titleShown = (spec: NonNullable<ListFormatSpec["section"]>): string =>
  typeof spec.title === "string" ? spec.title : spec.example!

interface Region {
  readonly start: number
  readonly end: number
}

/** The lines the list lives on, with the section-heading problems. */
const regionOf = (
  spec: ListFormatSpec,
  lines: readonly Line[],
): { readonly region?: Region; readonly problems: readonly SteeringFinding[] } => {
  const section = spec.section
  if (section === undefined) return { region: { start: 0, end: lines.length }, problems: [] }
  const problems: SteeringFinding[] = []
  const headings = lines.flatMap((line) => headingOf(line) ?? [])
  const matching = headings.filter((h) => titleMatches(section, h.title))
  const wanted = "#".repeat(section.level)
  for (const h of matching.filter((h) => h.level !== section.level))
    problems.push({
      line: h.line,
      message: `"${h.title}" is a level-${h.level} heading — write it as \`${wanted} ${h.title}\``,
    })
  const atLevel = matching.filter((h) => h.level === section.level)
  for (const h of atLevel.slice(1))
    problems.push({
      line: h.line,
      message: `"${h.title}" repeats the section on line ${atLevel[0]!.line + 1} — keep one`,
    })
  const first = atLevel[0]
  if (first === undefined) {
    if (section.required !== false && matching.length === 0)
      problems.push({ message: `missing the \`${wanted} ${titleShown(section)}\` section` })
    return { problems }
  }
  const next = headings.find((h) => h.line > first.line && h.level <= section.level)
  return { region: { start: first.line + 1, end: next?.line ?? lines.length }, problems }
}

interface Draft {
  readonly line: number
  parts: string[]
}

/** One pass over the region: items, their continuations, and every lint the format implies. */
// fallow-ignore-next-line complexity
const readItems = (
  spec: ListFormatSpec,
  lines: readonly Line[],
  region: Region,
): { readonly drafts: readonly Draft[]; readonly problems: readonly SteeringFinding[] } => {
  const markers = spec.markers ?? ["-"]
  const wrap = spec.wrap ?? "join"
  const problems: SteeringFinding[] = []
  const drafts: Draft[] = []
  let firstKind: ListMarker | undefined
  let current: Draft | undefined
  let blank = false
  let prose: number[] = []
  const continueWith = (line: Line, text: string): void => {
    if (wrap === "forbid") {
      problems.push({
        line: line.index,
        message: "one line per item — this line continues the one above",
      })
      return
    }
    current!.parts.push(text.trim())
  }
  for (const line of lines.slice(region.start, region.end)) {
    const text = line.text
    if (line.fenced) {
      // A fence indented under an item is that item's code; any other fence ends the item.
      if (current !== undefined && (line.fenceIndent ?? 0) >= 2) {
        blank = false
        continue
      }
      if (line.opens === true && current !== undefined) {
        prose.push(line.index)
        current = undefined
      } else if (line.opens !== true && ITEM_RE.test(text) && indentOf(text) < 2)
        problems.push({
          line: line.index,
          message: "a list item inside a code fence is not read as an item",
        })
      blank = false
      continue
    }
    if (text.trim() === "") {
      blank = true
      continue
    }
    const item = ITEM_RE.exec(text)
    const indent = indentOf(text)
    if (item !== null && indent < 2) {
      for (const p of prose)
        problems.push({
          line: p,
          message: "text between items — make it part of an item, or move it out of the list",
        })
      prose = []
      const kind = markerKind(item[2]!)
      if (!markers.includes(kind))
        problems.push({
          line: line.index,
          message: `\`${item[2]}\` is not an allowed marker — use ${markerList(markers)}`,
        })
      else if (firstKind !== undefined && kind !== firstKind)
        problems.push({
          line: line.index,
          message: `\`${item[2]}\` mixes markers in one list — the list started with \`${firstKind}\``,
        })
      firstKind ??= kind
      current = { line: line.index, parts: [(item[3] ?? "").trim()] }
      drafts.push(current)
      blank = false
      continue
    }
    if (current === undefined) {
      blank = false
      continue
    }
    if (item !== null) {
      problems.push({
        line: line.index,
        message: "nested list — this format is flat, one level of items",
      })
    } else if (indent >= 2) {
      continueWith(line, text)
    } else if (!blank) {
      problems.push({
        line: line.index,
        message:
          "continuation line is not indented — indent it under its item, or separate it with a blank line",
      })
      continueWith(line, text)
    } else {
      prose.push(line.index)
      current = undefined
    }
    blank = false
  }
  return { drafts, problems }
}

/** Strips a leading `[ ]`/`[x]`, reporting it where the format forbids or requires one. */
const readCheckbox = (
  spec: ListFormatSpec,
  draft: Draft,
  problems: SteeringFinding[],
): { readonly text: string; readonly checked?: boolean } => {
  const checkbox = spec.checkbox ?? "forbid"
  const text = draft.parts.join(" ").trim()
  const box = CHECKBOX_RE.exec(text)
  if (box === null) {
    if (checkbox === "require")
      problems.push({
        line: draft.line,
        message: "every item starts with a checkbox — write `- [ ] …`",
      })
    return checkbox === "forbid" ? { text } : { text, checked: false }
  }
  if (checkbox === "forbid")
    problems.push({ line: draft.line, message: "no checkboxes in this list — drop the `[ ]`" })
  const rest = text.slice(box[0].length).trim()
  return checkbox === "forbid" ? { text: rest } : { text: rest, checked: box[1] !== " " }
}

const finishItem = (
  spec: ListFormatSpec,
  draft: Draft,
  problems: SteeringFinding[],
): ListItem | undefined => {
  const { text, ...checked } = readCheckbox(spec, draft, problems)
  const item = spec.item
  if (text === "") {
    problems.push({ line: draft.line, message: "empty item" })
    return undefined
  }
  if (item === undefined) return { line: draft.line, text, ...checked }
  const at = text.indexOf(item.separator)
  const id = at < 0 ? "" : text.slice(0, at).trim()
  if (at < 0 || !item.id.test(id)) {
    problems.push({
      line: draft.line,
      message: `item has no ID — start it \`${item.example}${item.separator} …\``,
    })
    return undefined
  }
  const body = text.slice(at + item.separator.length).trim()
  if (body === "") problems.push({ line: draft.line, message: `empty item — ${id} has no text` })
  return { line: draft.line, text: body, id, ...checked }
}

const parseList = (spec: ListFormatSpec, content: string) => {
  const walked = walk(content)
  const { region, problems: sectionProblems } = regionOf(spec, walked.lines)
  const problems: SteeringFinding[] = [...walked.problems, ...sectionProblems]
  if (region === undefined) return { items: [], problems }
  const read = readItems(spec, walked.lines, region)
  problems.push(...read.problems)
  const items = read.drafts.flatMap((draft) => finishItem(spec, draft, problems) ?? [])
  if (spec.ids?.unique === true) {
    const seen = new Map<string, number>()
    for (const item of items) {
      if (item.id === undefined) continue
      const first = seen.get(item.id)
      if (first === undefined) seen.set(item.id, item.line)
      else
        problems.push({
          line: item.line,
          message: `duplicate ID ${item.id} — first on line ${first + 1}`,
        })
    }
  }
  problems.sort((a, b) => (a.line ?? -1) - (b.line ?? -1))
  return { items, problems }
}

const sectionSentence = (spec: ListFormatSpec): string => {
  if (spec.section === undefined) return "The whole document is the list."
  const heading = `${"#".repeat(spec.section.level)} ${titleShown(spec.section)}`
  return `Write the list under one \`${heading}\` heading; it ends at the next heading of the same or a higher level.`
}

const CHECKBOX_SENTENCE = {
  forbid: "Do not use checkboxes.",
  strip: "",
  require: "Start every item with a checkbox: `[ ]`, or `[x]` when done.",
} as const

const idSentence = (spec: ListFormatSpec): string => {
  if (spec.item === undefined) return ""
  const unique = spec.ids?.unique === true ? ", unique within the list" : ""
  return `Start every item with its ID (like \`${spec.item.example}\`${unique}), then \`${spec.item.separator}\`, then the text.`
}

const listInstructions = (spec: ListFormatSpec): string =>
  [
    sectionSentence(spec),
    `Write each item as a ${markerList(spec.markers ?? ["-"])} list item, all with the same marker.`,
    CHECKBOX_SENTENCE[spec.checkbox ?? "forbid"],
    idSentence(spec),
    (spec.wrap ?? "join") === "join"
      ? "Continue a long item on lines indented two spaces under it."
      : "Keep every item on one line.",
    "Keep the list flat: no nested items, and no text between items. Items inside a code fence are not read.",
  ]
    .filter((sentence) => sentence !== "")
    .join(" ")

const listSample = (spec: ListFormatSpec): string => {
  const marker = (spec.markers ?? ["-"])[0] === "1." ? "1." : (spec.markers ?? ["-"])[0]!
  const box = spec.checkbox === "require" ? "[ ] " : ""
  const id = spec.item !== undefined ? `${spec.item.example}${spec.item.separator} ` : ""
  const item = `${marker} ${box}${id}Describe the item.\n`
  return spec.section === undefined
    ? item
    : `${"#".repeat(spec.section.level)} ${titleShown(spec.section)}\n\n${item}`
}

// --- sectionFormat -----------------------------------------------------------

const bodyOf = (lines: readonly Line[], start: number, end: number): string =>
  lines
    .slice(start, end)
    .map((l) => l.text)
    .join("\n")
    .trim()

/** The problem with heading `i` as a section, if any; `null` when it is not a section heading at all. */
const sectionHeadingProblem = (
  spec: SectionFormatSpec,
  headings: readonly Heading[],
  i: number,
  firstLine: ReadonlyMap<string, number>,
): string | null | undefined => {
  const h = headings[i]!
  if (h.level < spec.level && headings.slice(0, i).some((p) => p.level === spec.level))
    return `"${h.title}" is a level-${h.level} heading — sections are \`${"#".repeat(spec.level)}\``
  if (h.level !== spec.level) return null
  if (h.title === "") return "section heading has no title"
  const first = firstLine.get(h.title.toLowerCase())
  return spec.title === "unique" && first !== undefined
    ? `"${h.title}" repeats the section on line ${first + 1} — titles are unique`
    : undefined
}

const parseSections = (spec: SectionFormatSpec, content: string) => {
  const walked = walk(content)
  const problems: SteeringFinding[] = [...walked.problems]
  const headings = walked.lines.flatMap((line) => headingOf(line) ?? [])
  const sections: Section[] = []
  const firstLine = new Map<string, number>()
  for (const [i, h] of headings.entries()) {
    const problem = sectionHeadingProblem(spec, headings, i, firstLine)
    if (problem === null) continue
    if (problem !== undefined) problems.push({ line: h.line, message: problem })
    if (h.level !== spec.level || h.title === "") continue
    if (!firstLine.has(h.title.toLowerCase())) firstLine.set(h.title.toLowerCase(), h.line)
    const end =
      headings.slice(i + 1).find((n) => n.level <= spec.level)?.line ?? walked.lines.length
    sections.push({ line: h.line, title: h.title, body: bodyOf(walked.lines, h.line + 1, end) })
  }
  problems.sort((a, b) => (a.line ?? -1) - (b.line ?? -1))
  return { sections, problems }
}

const sectionInstructions = (spec: SectionFormatSpec): string => {
  const hashes = "#".repeat(spec.level)
  return [
    `Write each section under a \`${hashes} Title\` heading.`,
    spec.title === "unique" ? "No two sections share a title." : "",
    spec.level > 1
      ? `Use deeper headings inside a section only; no heading above \`${hashes}\` after the first section.`
      : "",
    "Close every code fence.",
  ]
    .filter((s) => s !== "")
    .join(" ")
}

// --- construction and the spec round-trip ------------------------------------

const NAME_RE = /^[a-z][a-z0-9-]*$/

type EncodedPattern = { readonly source: string; readonly flags: string }

// `g`/`y` make `test` stateful; a format matches each line afresh.
const pattern = (re: RegExp): RegExp => new RegExp(re.source, re.flags.replace(/[gy]/g, ""))

const encode = (value: unknown): unknown =>
  value instanceof RegExp
    ? { source: value.source, flags: value.flags }
    : Array.isArray(value)
      ? value.map(encode)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]))
        : value

const isPattern = (value: unknown): value is EncodedPattern =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as EncodedPattern).source === "string" &&
  typeof (value as EncodedPattern).flags === "string"

const checkName = (name: unknown): string => {
  if (typeof name !== "string" || !NAME_RE.test(name))
    throw new Error(
      `format name must be lowercase letters, digits and "-" — got ${JSON.stringify(name)}`,
    )
  return name
}

const withThreads = <P extends { readonly problems: readonly SteeringFinding[] }>(
  name: string,
  spec: unknown,
  kind: "list" | "section",
  parse: (content: string) => P,
  instructions: string,
  sample: string,
): DeclaredFormat<Omit<P, "problems">> => ({
  ...freeFormFormat,
  openThreads: openThreadsOf,
  name,
  spec: JSON.stringify({ kind, ...(encode(spec) as object) }),
  instructions,
  sample,
  parse,
  validate: (content) => [...parse(content).problems, ...threadFindings(content)],
})

/** Declares a list format: `parse`, `validate`, `instructions` and `sample` all derive from `spec`. Usable as a step's `mode`. */
export const listFormat = (spec: ListFormatSpec): ListFormat => {
  const name = checkName(spec.name)
  const normalized: ListFormatSpec = {
    ...spec,
    ...(spec.section !== undefined && typeof spec.section.title !== "string"
      ? { section: { ...spec.section, title: pattern(spec.section.title) } }
      : {}),
    ...(spec.item !== undefined ? { item: { ...spec.item, id: pattern(spec.item.id) } } : {}),
  }
  if ((normalized.markers ?? ["-"]).length === 0)
    throw new Error(`format "${name}": markers is empty`)
  if (normalized.item !== undefined && !normalized.item.id.test(normalized.item.example))
    throw new Error(
      `format "${name}": item.example "${normalized.item.example}" does not match item.id`,
    )
  const section = normalized.section
  if (
    section !== undefined &&
    typeof section.title !== "string" &&
    (section.example === undefined || !section.title.test(section.example))
  )
    throw new Error(`format "${name}": a RegExp section.title needs a section.example it matches`)
  const format = withThreads(
    name,
    normalized,
    "list",
    (content) => parseList(normalized, content),
    listInstructions(normalized),
    listSample(normalized),
  )
  if (format.parse(format.sample).problems.length > 0)
    throw new Error(`format "${name}": its own sample does not validate`)
  return format
}

/** Declares a document of headed sections. Usable as a step's `mode`. */
export const sectionFormat = (spec: SectionFormatSpec): SectionFormat => {
  const name = checkName(spec.name)
  const hashes = "#".repeat(spec.level)
  return withThreads(
    name,
    spec,
    "section",
    (content) => parseSections(spec, content),
    sectionInstructions(spec),
    `${hashes} First section\n\nWhat this section says.\n`,
  )
}

const decodePatterns = (value: unknown, key?: string): unknown =>
  (key === "title" || key === "id") && isPattern(value)
    ? new RegExp(value.source, value.flags)
    : Array.isArray(value)
      ? value.map((v) => decodePatterns(v))
      : typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodePatterns(v, k)]))
        : value

/** The format a declared format's `spec` describes — what `gtd check --spec` validates with. Throws on a spec no declaration produces. */
export const formatFromSpec = (spec: string): ListFormat | SectionFormat => {
  const decoded = decodePatterns(JSON.parse(spec)) as { readonly kind?: unknown }
  const { kind, ...rest } = decoded as { kind?: unknown } & Record<string, unknown>
  if (kind === "list") return listFormat(rest as unknown as ListFormatSpec)
  if (kind === "section") return sectionFormat(rest as unknown as SectionFormatSpec)
  throw new Error(`not a declared format spec: ${JSON.stringify(kind)}`)
}
