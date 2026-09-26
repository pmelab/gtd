// The commit-message codec: the `gtd(<actor>): <from> → <to>` subject plus
// the `Gtd-*` trailers a step commit carries. A malformed trailer (never
// written by gtd) is skipped, not fatal — a corrupt line must never make every
// command unusable.

export const TRANSITION_SEP = " → "

export interface ParsedSubject {
  readonly actor: string
  readonly to: string
  readonly from?: string
}

const SUBJECT_RE = /^gtd\(([^()]+)\): (.+)$/

/** `from` equal to `to` (or absent) collapses to the bare `gtd(<actor>): <to>` form. */
export const formatSubject = (actor: string, to: string, from?: string): string =>
  from === undefined || from === to
    ? `gtd(${actor}): ${to}`
    : `gtd(${actor}): ${from}${TRANSITION_SEP}${to}`

export const parseSubject = (subject: string): ParsedSubject | undefined => {
  const match = SUBJECT_RE.exec(subject.trim())
  const actor = match?.[1]
  const rest = match?.[2]
  if (actor === undefined || rest === undefined) return undefined
  const sep = rest.lastIndexOf(TRANSITION_SEP)
  if (sep === -1) return { actor, to: rest }
  const from = rest.slice(0, sep)
  const to = rest.slice(sep + TRANSITION_SEP.length)
  if (from === "" || to === "") return undefined
  return { actor, to, from }
}

export interface StepId {
  readonly name: string
  readonly occurrence: number
}

export const formatStepId = (id: StepId): string => `${id.name}#${id.occurrence}`

const STEP_ID_RE = /^(.+)#([1-9][0-9]*)$/

const parseStepId = (raw: string): StepId | undefined => {
  const match = STEP_ID_RE.exec(raw.trim())
  if (match === null) return undefined
  return { name: match[1]!, occurrence: Number(match[2]) }
}

export interface JudgeVerdict {
  readonly id: string
  readonly answer: string | number | boolean
  readonly p: number
}

export interface CostEntry {
  readonly cost: number
  readonly model: string | undefined
}

export interface CommitMessage {
  readonly subject: string
  readonly parsed: ParsedSubject | undefined
  readonly step: StepId | undefined
  readonly judge: readonly JudgeVerdict[]
  readonly vars: Readonly<Record<string, string>>
  readonly reviewBase: string | undefined
  readonly cost: readonly CostEntry[]
  readonly truncated: boolean
}

const isVerdict = (value: unknown): value is JudgeVerdict => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    ["string", "number", "boolean"].includes(typeof v.answer) &&
    typeof v.p === "number"
  )
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

const TRAILER_RE = /^(Gtd-[A-Za-z-]+):[ \t]*(.*?)[ \t]*$/gm
const COST_RE = /^([0-9]+(?:\.[0-9]+)?)(?:[ \t]+(.+))?$/
const VAR_RE = /^([^=\s]+)=(.*)$/

interface Trailers {
  step: StepId | undefined
  reviewBase: string | undefined
  truncated: boolean
  readonly judge: JudgeVerdict[]
  readonly vars: Record<string, string>
  readonly cost: CostEntry[]
}

const TRAILER_READERS: Readonly<Record<string, (value: string, into: Trailers) => void>> = {
  "Gtd-Step": (value, into) => {
    into.step ??= parseStepId(value)
  },
  "Gtd-Judge": (value, into) => {
    const parsed = parseJson(value)
    if (isVerdict(parsed)) into.judge.push(parsed)
  },
  "Gtd-Var": (value, into) => {
    const kv = VAR_RE.exec(value)
    if (kv !== null) into.vars[kv[1]!] = kv[2]!
  },
  "Gtd-Review-Base": (value, into) => {
    into.reviewBase ??= value.split(/\s/)[0]
  },
  "Gtd-Cost": (value, into) => {
    const c = COST_RE.exec(value)
    if (c !== null) into.cost.push({ cost: Number(c[1]), model: c[2]?.trim() || undefined })
  },
  "Gtd-Payload": (value, into) => {
    const parsed = parseJson(value)
    if (typeof parsed === "object" && parsed !== null && "truncated" in parsed) {
      into.truncated = (parsed as { truncated: unknown }).truncated === true
    }
  },
}

export const parseCommitMessage = (message: string): CommitMessage => {
  const newline = message.indexOf("\n")
  const subject = (newline === -1 ? message : message.slice(0, newline)).trim()
  const trailers: Trailers = {
    step: undefined,
    reviewBase: undefined,
    truncated: false,
    judge: [],
    vars: {},
    cost: [],
  }
  if (newline !== -1) {
    for (const match of message.slice(newline).matchAll(TRAILER_RE)) {
      TRAILER_READERS[match[1]!]?.(match[2]!, trailers)
    }
  }
  return { subject, parsed: parseSubject(subject), ...trailers }
}

export interface CommitSpec {
  readonly actor: string
  readonly to: string
  readonly from?: string
  readonly step?: StepId
  readonly reviewBase?: string
  readonly vars?: Readonly<Record<string, string>>
  readonly cost?: { readonly cost: number; readonly model?: string }
  readonly judge?: readonly JudgeVerdict[]
  readonly truncated?: boolean
}

/** Trailer order is fixed so the same spec always yields the same bytes. */
export const formatCommitMessage = (spec: CommitSpec): string => {
  const lines: string[] = []
  if (spec.step !== undefined) lines.push(`Gtd-Step: ${formatStepId(spec.step)}`)
  if (spec.reviewBase !== undefined) lines.push(`Gtd-Review-Base: ${spec.reviewBase}`)
  for (const [name, value] of Object.entries(spec.vars ?? {}))
    lines.push(`Gtd-Var: ${name}=${value}`)
  if (spec.cost !== undefined) {
    lines.push(
      `Gtd-Cost: ${spec.cost.cost}${spec.cost.model !== undefined ? ` ${spec.cost.model}` : ""}`,
    )
  }
  for (const verdict of spec.judge ?? []) lines.push(`Gtd-Judge: ${JSON.stringify(verdict)}`)
  if (spec.truncated === true) lines.push(`Gtd-Payload: ${JSON.stringify({ truncated: true })}`)
  const subject = formatSubject(spec.actor, spec.to, spec.from)
  return lines.length === 0 ? subject : `${subject}\n\n${lines.join("\n")}`
}
