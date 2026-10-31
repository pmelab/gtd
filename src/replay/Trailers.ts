// The commit-message codec: the `gtd(<actor>): <from> → <to>` subject plus
// the `Gtd-*` trailers a step commit carries. A malformed trailer (never
// written by gtd) is skipped, not fatal — a corrupt line must never make every
// command unusable.

import type { Mark } from "../flows/index.js"
import type { PinMark } from "../wire/index.js"
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

export type PinChange = PinMark

/** Step names a workflow may not take: gtd's own beats live under it. */
export const ENGINE_PREFIX = "gtd:"

/** What a pin and an unpin beat rest at, and their commits name — neither is a step of the workflow. */
export const PIN_STATES: Readonly<Record<PinChange, string>> = {
  add: `${ENGINE_PREFIX}pin`,
  remove: `${ENGINE_PREFIX}unpin`,
}

/** The names formats 2 and 3 gave the pin beats, before `gtd:` reserved them. */
export const LEGACY_PIN_STATES: Readonly<Record<PinChange, string>> = {
  add: "pin",
  remove: "unpin",
}

const SCOPED_PIN_FORMAT = 4

/** The name a commit in `format` gives a pin beat; format 1 has none. */
export const pinStateIn = (format: number, change: PinChange): string | undefined =>
  format >= SCOPED_PIN_FORMAT
    ? PIN_STATES[change]
    : format >= 2
      ? LEGACY_PIN_STATES[change]
      : undefined

export interface CommitMessage {
  readonly subject: string
  readonly parsed: ParsedSubject | undefined
  readonly step: StepId | undefined
  /** Written only on a process's opening commit. */
  readonly workflow: string | undefined
  readonly judge: readonly JudgeVerdict[]
  /** `Gtd-Mark`, in order; a malformed or control-character line is skipped. */
  readonly marks: readonly Mark[]
  readonly vars: Readonly<Record<string, string>>
  readonly reviewBase: string | undefined
  readonly cost: readonly CostEntry[]
  /** Written only on a process's finishing landing. */
  readonly branch: string | undefined
  readonly version: string | undefined
  /** The off-branch tip a keep step set aside; a non-hash value is skipped. */
  readonly kept: string | undefined
  /** `Gtd-Approved`; a malformed or control-character value is skipped. */
  readonly approved: Approval | undefined
  /** `Gtd-Pin`: a commit that adds or removes the pin — never a turn. */
  readonly pin: PinChange | undefined
  /** `Gtd-Anchor`, on a repin's commit: replay sets aside every commit after this one; a non-hash value is skipped. */
  readonly anchor: string | undefined
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
// A control character is refused on read: history written by someone else
// must never put escape sequences on a terminal.
// eslint-disable-next-line no-control-regex -- the control range IS the point
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/
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
const MARK_RE = /^([a-z][a-z0-9-]*)=(.+)$/
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
  pin: PinChange | undefined
  anchor: string | undefined
  readonly judge: JudgeVerdict[]
  readonly marks: Mark[]
  readonly vars: Record<string, string>
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
  "Gtd-Mark": (value, into) => {
    const kv = MARK_RE.exec(value)
    if (kv !== null && !CONTROL_CHARACTER.test(value))
      into.marks.push({ name: kv[1]!, value: kv[2]! })
  },
  "Gtd-Var": (value, into) => {
    const kv = VAR_RE.exec(value)
    if (kv !== null) into.vars[kv[1]!] = kv[2]!
  },
  "Gtd-Review-Base": (value, into) => {
    into.reviewBase ??= value.split(/\s/)[0]
  },
  "Gtd-Branch": (value, into) => {
    if (value !== "") into.branch ??= value
  },
  "Gtd-Version": (value, into) => {
    // Untrusted (fetched history): control bytes would reach the terminal; a rejected value reads as unknown.
    // eslint-disable-next-line no-control-regex
    if (value !== "" && !/[\u0000-\u001f\u007f-\u009f]/.test(value)) into.version ??= value
  },
  "Gtd-Kept": (value, into) => {
    if (HASH_RE.test(value)) into.kept ??= value
  },
  "Gtd-Approved": (value, into) => {
    into.approved ??= decodeApproval(value)
  },
  "Gtd-Pin": (value, into) => {
    if (value === "add" || value === "remove") into.pin ??= value
  },
  "Gtd-Anchor": (value, into) => {
    if (HASH_RE.test(value)) into.anchor ??= value
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
    pin: undefined,
    anchor: undefined,
    judge: [],
    marks: [],
    vars: {},
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
  readonly cost?: { readonly cost: number; readonly model?: string }
  readonly judge?: readonly JudgeVerdict[]
  /** Written after `Gtd-Judge`, before `Gtd-Approved`. */
  readonly marks?: readonly Mark[]
  /** Written after `Gtd-Mark`, before `Gtd-Branch`. */
  readonly approved?: Approval
  readonly pin?: PinChange
  readonly anchor?: string
  readonly branch?: string
  readonly version?: string
}

const sortedEntries = (record: Readonly<Record<string, string>> = {}): [string, string][] =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/** Trailer order is fixed so the same spec always yields the same bytes. */
const trailer = (name: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [`Gtd-${name}: ${value}`]

const costValue = (cost: CommitSpec["cost"]): string | undefined =>
  cost === undefined ? undefined : `${cost.cost}${cost.model !== undefined ? ` ${cost.model}` : ""}`

export const formatCommitMessage = (spec: CommitSpec): string => {
  const lines = [
    ...trailer("Step", spec.step && formatStepId(spec.step)),
    ...trailer("Workflow", spec.workflow),
    ...trailer("Review-Base", spec.reviewBase),
    ...sortedEntries(spec.vars).map(([name, value]) => `Gtd-Var: ${name}=${value}`),
    ...trailer("Cost", costValue(spec.cost)),
    ...(spec.judge ?? []).map((verdict) => `Gtd-Judge: ${JSON.stringify(verdict)}`),
    ...(spec.marks ?? []).map((m) => `Gtd-Mark: ${m.name}=${m.value}`),
    ...trailer("Approved", spec.approved && encodeApproval(spec.approved)),
    ...trailer("Pin", spec.pin),
    ...trailer("Anchor", spec.anchor),
    ...trailer("Branch", spec.branch),
    ...trailer("Version", spec.version),
    `Gtd-Format: ${HISTORY_FORMAT}`,
  ]
  const subject = formatSubject(spec.actor, spec.to, spec.from)
  return `${subject}\n\n${lines.join("\n")}`
}
