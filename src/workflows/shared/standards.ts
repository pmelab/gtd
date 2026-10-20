import { ANSWER_LEAD, FREE_TEXT_PLACEHOLDER } from "../../steering/index.js"

export const STANDARDS = ".gtd/STANDARDS.md"

/** A learned standard that contradicts decided ones, waiting on the human. */
export interface Conflict {
  readonly text: string
  /** The decided standards it contradicts. */
  readonly olds: readonly string[]
}

export interface Standards {
  readonly decided: readonly string[]
  readonly undecided: readonly Conflict[]
}

const UNDECIDED = "Undecided"

// The same class as the review's `Gtd-Mark` anchors, so a title reads alike in both.
export const oneLine = (text: string): string =>
  // eslint-disable-next-line no-control-regex -- the control range IS the point
  text.replace(/[\s\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, " ").trim()

const ITEM = /^[-*+]\s+(.*)$/
const CONTRADICTS = /^\s+[-*+]\s+contradicts:\s*(.*)$/i

interface Item {
  text: string
  /** Set under `## Undecided`. */
  olds?: string[]
}

// A formatter wraps long lines: the tail belongs to the last `contradicts:` once there is one.
const wrapped = (item: Item, line: string): void => {
  const olds = item.olds
  if (olds !== undefined && olds.length > 0) olds[olds.length - 1] += ` ${line.trim()}`
  else item.text += ` ${line.trim()}`
}

const toStandards = (items: readonly Item[]): Standards => {
  const kept = items.filter((i) => oneLine(i.text) !== "")
  return {
    decided: kept.filter((i) => i.olds === undefined).map((i) => oneLine(i.text)),
    undecided: kept.flatMap((i) =>
      i.olds === undefined
        ? []
        : [{ text: oneLine(i.text), olds: i.olds.map(oneLine).filter((o) => o !== "") }],
    ),
  }
}

/**
 * Every top-level bullet is one standard, those under `## Undecided` waiting
 * on the human; a hand-edited file may group the rest under any heading.
 */
export const parseStandards = (text: string): Standards => {
  const items: Item[] = []
  let pending = false
  let last: Item | undefined
  for (const line of text.split("\n")) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const item = ITEM.exec(line)
    const old = CONTRADICTS.exec(line)
    if (heading !== null) {
      pending = heading[1]!.length > 1 && heading[2]!.trim() === UNDECIDED
      last = undefined
    } else if (item !== null) {
      last = pending ? { text: item[1]!, olds: [] } : { text: item[1]! }
      items.push(last)
    } else if (old !== null && last?.olds !== undefined) last.olds.push(old[1]!)
    else if (/^\s+\S/.test(line) && last !== undefined) wrapped(last, line)
    else if (line.trim() !== "") last = undefined
  }
  return toStandards(items)
}

export const renderStandards = ({ decided, undecided }: Standards): string => {
  const parts = [
    "# Standards",
    "Learned from your review answers and read by every agent turn. Edit freely.",
    ...(decided.length === 0 ? [] : [decided.map((s) => `- ${s}`).join("\n")]),
    ...(undecided.length === 0
      ? []
      : [
          `## ${UNDECIDED}`,
          undecided
            .map((c) => [`- ${c.text}`, ...c.olds.map((o) => `  - contradicts: ${o}`)].join("\n"))
            .join("\n"),
        ]),
  ]
  return `${parts.join("\n\n")}\n`
}

// FNV-1a: a conflict's chunk title must survive markdown parsing, which its text may not.
const hash = (text: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, "0")
}

const CONFLICT_TITLE = /^Standard conflict ([0-9a-f]{8})$/

export const conflictTitle = (c: Conflict): string => `Standard conflict ${hash(c.text)}`

/** The undecided standard a review chunk titled `title` asks about. */
export const conflictFor = (standards: Standards, title: string): Conflict | undefined => {
  const id = CONFLICT_TITLE.exec(title)?.[1]
  return id === undefined ? undefined : standards.undecided.find((c) => hash(c.text) === id)
}

export const isConflictTitle = (title: string): boolean => CONFLICT_TITLE.test(title)

const KEEP_NEW = "keep the new one (drop the old)"
const KEEP_OLD = "keep the old one (discard the new)"

/** A conflict's chunk body; its three boxes read as fix / won't fix / own answer by position. */
export const conflictBody = (c: Conflict): string =>
  [
    `A standard learned from your answers contradicts ${c.olds.length === 1 ? "one" : "some"} already in \`${STANDARDS}\`. Your own answer replaces both with its wording.`,
    `New: ${c.text}`,
    `Old:\n\n${c.olds.map((o) => `- ${o}`).join("\n")}`,
    `${ANSWER_LEAD}\n\n- [ ] ${KEEP_NEW}\n- [ ] ${KEEP_OLD}\n- [ ] ${FREE_TEXT_PLACEHOLDER}`,
  ].join("\n\n")

/** What every agent turn is told while `.gtd/STANDARDS.md` holds decided standards. */
export const standardsBlock = (text: string | undefined): string => {
  const { decided } = parseStandards(text ?? "")
  if (decided.length === 0) return ""
  return `## Standards

\`${STANDARDS}\` holds the standards the human set in earlier reviews.
Follow every one in what you write. Reviewing, never raise a finding a
standard rules out — a \`Won't fix:\` standard is a finding the human
rejected, so never raise it or one like it again — and raise breaking a
standard as a finding.

${decided.map((s) => `- ${s}`).join("\n")}`
}
