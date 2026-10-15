// The commit-message codec: the `gtd(<actor>): <from> → <to>` subject plus
// the `Gtd-*` trailers a step commit carries. A malformed trailer (never
// written by gtd) is skipped, not fatal — a corrupt line must never make every
// command unusable.

import { HISTORY_FORMAT } from "./Format.js"

const TRANSITION_SEP = " → "

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

export interface Approval {
  readonly step: StepId
  readonly name: string
  readonly email: string
}

export interface CommitMessage {
  readonly subject: string
  readonly parsed: ParsedSubject | undefined
  readonly step: StepId | undefined
  /** Written only on a process's opening commit. */
  readonly workflow: string | undefined
  readonly judge: readonly JudgeVerdict[]
  readonly vars: Readonly<Record<string, string>>
  /** Written only on a process's first commit. */
  readonly config: Readonly<Record<string, string>>
  readonly reviewBase: string | undefined
  readonly cost: readonly CostEntry[]
  /** Written only on a process's finishing landing. */
  readonly branch: string | undefined
  readonly version: string | undefined
  /** The off-branch tip a keep step set aside; a non-hash value is skipped. */
  readonly kept: string | undefined
  /** `Gtd-Approved`; a malformed or control-character value is skipped. */
  readonly approved: Approval | undefined
  readonly format: number
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
const CONFIG_RE = /^([0-9a-f]{16}) (.+)$/
// A path git's message cleanup or the trailer syntax would alter travels as a
// JSON string. A control character is refused on read: history written by
// someone else must never put escape sequences on a terminal.
// eslint-disable-next-line no-control-regex -- the control range IS the point
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/
const encodePath = (path: string): string =>
  path.trim() !== path || path.startsWith('"') || CONTROL_CHARACTER.test(path)
    ? JSON.stringify(path)
    : path
const decodePath = (raw: string): string | undefined => {
  const path = raw.startsWith('"') ? parseJson(raw) : raw
  return typeof path === "string" && path !== "" && !CONTROL_CHARACTER.test(path) ? path : undefined
}
const decodeApproval = (raw: string): Approval | undefined => {
  const parsed = parseJson(raw)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  const { step, name, email } = parsed as Record<string, unknown>
  if (typeof step !== "string" || typeof name !== "string" || typeof email !== "string")
    return undefined
  if ([step, name, email].some((field) => CONTROL_CHARACTER.test(field))) return undefined
  const id = parseStepId(step)
  return id === undefined ? undefined : { step: id, name, email }
}
const encodeApproval = ({ step, name, email }: Approval): string =>
  JSON.stringify({ step: formatStepId(step), name, email })
// The land-time refusal relies on this: an approval that would not read back
// unchanged must never be written.
export const isRecordableApproval = (approval: Approval): boolean => {
  const back = decodeApproval(encodeApproval(approval))
  return back !== undefined && encodeApproval(back) === encodeApproval(approval)
}
const FORMAT_RE = /^[1-9][0-9]*$/
const HASH_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

interface Trailers {
  step: StepId | undefined
  workflow: string | undefined
  reviewBase: string | undefined
  branch: string | undefined
  version: string | undefined
  kept: string | undefined
  approved: Approval | undefined
  readonly judge: JudgeVerdict[]
  readonly vars: Record<string, string>
  readonly config: Record<string, string>
  readonly cost: CostEntry[]
  format: number | undefined
}

const TRAILER_READERS: Readonly<Record<string, (value: string, into: Trailers) => void>> = {
  "Gtd-Step": (value, into) => {
    into.step ??= parseStepId(value)
  },
  "Gtd-Workflow": (value, into) => {
    if (value !== "") into.workflow ??= value
  },
  "Gtd-Judge": (value, into) => {
    const parsed = parseJson(value)
    if (isVerdict(parsed)) into.judge.push(parsed)
  },
  "Gtd-Var": (value, into) => {
    const kv = VAR_RE.exec(value)
    if (kv !== null) into.vars[kv[1]!] = kv[2]!
  },
  "Gtd-Config": (value, into) => {
    const entry = CONFIG_RE.exec(value)
    const path = entry === null ? undefined : decodePath(entry[2]!)
    if (path !== undefined) into.config[path] = entry![1]!
  },
  "Gtd-Review-Base": (value, into) => {
    into.reviewBase ??= value.split(/\s/)[0]
  },
  "Gtd-Branch": (value, into) => {
    if (value !== "") into.branch ??= value
  },
  "Gtd-Version": (value, into) => {
    if (value !== "") into.version ??= value
  },
  "Gtd-Kept": (value, into) => {
    if (HASH_RE.test(value)) into.kept ??= value
  },
  "Gtd-Approved": (value, into) => {
    into.approved ??= decodeApproval(value)
  },
  "Gtd-Format": (value, into) => {
    if (FORMAT_RE.test(value)) into.format ??= Number(value)
  },
  "Gtd-Cost": (value, into) => {
    const c = COST_RE.exec(value)
    if (c !== null) into.cost.push({ cost: Number(c[1]), model: c[2]?.trim() || undefined })
  },
}

export const parseCommitMessage = (message: string): CommitMessage => {
  const newline = message.indexOf("\n")
  const subject = (newline === -1 ? message : message.slice(0, newline)).trim()
  const trailers: Trailers = {
    step: undefined,
    workflow: undefined,
    reviewBase: undefined,
    branch: undefined,
    version: undefined,
    kept: undefined,
    approved: undefined,
    judge: [],
    vars: {},
    config: {},
    cost: [],
    format: undefined,
  }
  if (newline !== -1) {
    for (const match of message.slice(newline).matchAll(TRAILER_RE)) {
      TRAILER_READERS[match[1]!]?.(match[2]!, trailers)
    }
  }
  return { subject, parsed: parseSubject(subject), ...trailers, format: trailers.format ?? 1 }
}

export interface CommitSpec {
  readonly actor: string
  readonly to: string
  readonly from?: string
  readonly step?: StepId
  readonly workflow?: string
  readonly reviewBase?: string
  readonly vars?: Readonly<Record<string, string>>
  readonly config?: Readonly<Record<string, string>>
  readonly cost?: { readonly cost: number; readonly model?: string }
  readonly judge?: readonly JudgeVerdict[]
  /** Written after `Gtd-Judge`, before `Gtd-Branch`. */
  readonly approved?: Approval
  readonly branch?: string
  readonly version?: string
}

const sortedEntries = (record: Readonly<Record<string, string>> = {}): [string, string][] =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/** Trailer order is fixed so the same spec always yields the same bytes. */
export const formatCommitMessage = (spec: CommitSpec): string => {
  const lines: string[] = []
  if (spec.step !== undefined) lines.push(`Gtd-Step: ${formatStepId(spec.step)}`)
  if (spec.workflow !== undefined) lines.push(`Gtd-Workflow: ${spec.workflow}`)
  if (spec.reviewBase !== undefined) lines.push(`Gtd-Review-Base: ${spec.reviewBase}`)
  for (const [name, value] of sortedEntries(spec.vars)) lines.push(`Gtd-Var: ${name}=${value}`)
  for (const [path, hash] of sortedEntries(spec.config))
    lines.push(`Gtd-Config: ${hash} ${encodePath(path)}`)
  if (spec.cost !== undefined) {
    lines.push(
      `Gtd-Cost: ${spec.cost.cost}${spec.cost.model !== undefined ? ` ${spec.cost.model}` : ""}`,
    )
  }
  for (const verdict of spec.judge ?? []) lines.push(`Gtd-Judge: ${JSON.stringify(verdict)}`)
  if (spec.approved !== undefined) {
    lines.push(`Gtd-Approved: ${encodeApproval(spec.approved)}`)
  }
  if (spec.branch !== undefined) lines.push(`Gtd-Branch: ${spec.branch}`)
  if (spec.version !== undefined) lines.push(`Gtd-Version: ${spec.version}`)
  lines.push(`Gtd-Format: ${HISTORY_FORMAT}`)
  const subject = formatSubject(spec.actor, spec.to, spec.from)
  return `${subject}\n\n${lines.join("\n")}`
}
