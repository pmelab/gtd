import type { BeatKind } from "./Demand.js"
import type { BeatDocument } from "./BeatDocument.js"
import type { StatusChange } from "./BeatStatus.js"
import { UNATTRIBUTED_MODEL } from "./constants.js"
import type { ModelCost } from "./types.js"

/**
 * True when the per-model breakdown adds information beyond the `Cost:`
 * total: more than one model, or a single model that carries an actual
 * `--model` tag (a lone `unspecified` bucket just restates the total, so
 * it's suppressed).
 */
const breakdownIsInformative = (byModel: readonly ModelCost[]): boolean =>
  byModel.length > 1 || (byModel.length === 1 && byModel[0]!.model !== UNATTRIBUTED_MODEL)

const costStatusLines = (cost: number, byModel: readonly ModelCost[]): string[] => {
  if (cost <= 0) return []
  const lines = [`Cost: ${cost}`]
  if (breakdownIsInformative(byModel)) {
    for (const m of byModel) lines.push(`  ${m.model}: ${m.cost}`)
  }
  return lines
}

const pendingStatusLines = (statusChanges: readonly StatusChange[]): string[] =>
  statusChanges.length === 0
    ? ["Pending: (clean)"]
    : [
        "Pending:",
        ...statusChanges.map((c) => `  ${c.status} ${c.path} -> ${c.pattern ?? "(no match)"}`),
      ]

const nextStatusLine = (next: BeatDocument["next"]): string =>
  next === null
    ? "Next: (no match — nothing would happen)"
    : `Next: ${next.action ?? next.pattern} → ${next.target}`

/** Builds `{[key]: value}` for each entry whose value isn't `undefined` — the shared "omit absent optional fields" shape the header uses. */
const definedFields = (
  entries: readonly (readonly [string, unknown])[],
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of entries) if (value !== undefined) result[key] = value
  return result
}

/**
 * The header block's own lines — `State:`/`Awaits:`/optional `Label:`/
 * `Model:`/`Memory:`/`File:`/`Mode:`/`Cost:`(+breakdown)/`Pending:`/`Next:`,
 * in that order. Used by `renderBeatPlain`'s header-showing kinds below.
 */
const beatHeaderLines = (document: BeatDocument): string[] => {
  const optional = definedFields([
    ["Label", document.label],
    ["Model", document.model],
    ["Memory", document.memory],
    ["File", document.file],
    ["Mode", document.mode],
  ])
  return [
    `State: ${document.state}`,
    `Awaits: ${document.actor}`,
    ...Object.entries(optional).map(([key, value]) => `${key}: ${value}`),
    ...costStatusLines(document.cost ?? 0, document.costByModel ?? []),
    ...pendingStatusLines(document.changes),
    nextStatusLine(document.next),
  ]
}

/** `script`'s plain-output instruction line — a literal constant, never a template. */
const SCRIPT_INSTRUCTION = "Run this script:"

/** `capture`'s plain-output instruction line — a literal constant, never a template. */
const CAPTURE_INSTRUCTION = "The edit is already made — run `gtd land` to land it."

/** One `BeatKind`'s plain-render briefing: the instruction line prepended above the header (`undefined` for none), and whether the status header is suppressed entirely (`prompt` alone — those bytes ARE the agent's input). */
export interface DemandBriefing {
  readonly instructionLine: string | undefined
  readonly suppressHeader: boolean
}

/**
 * One entry per `BeatKind`, typed as `Record<BeatKind, DemandBriefing>` so
 * the object literal itself is exhaustive: adding or removing a `BeatKind`
 * member without updating this map fails `tsc`, the same guarantee
 * `dispatchFieldsOf`'s switch (`BeatDocument.ts`) gives the JSON side. Exported
 * so the one cross-cutting exhaustiveness test (`BeatDocument.test.ts`) can
 * assert against it directly, rather than re-deriving it from
 * `renderBeatPlain`'s output. Replaces the old `renderBeatPlain`'s hand-written
 * `if (kind === "script") … if (kind === "capture") …` pair.
 */
export const DEMAND_BRIEFING: Record<BeatKind, DemandBriefing> = {
  capture: { instructionLine: CAPTURE_INSTRUCTION, suppressHeader: false },
  message: { instructionLine: undefined, suppressHeader: false },
  script: { instructionLine: SCRIPT_INSTRUCTION, suppressHeader: false },
  stalled: { instructionLine: undefined, suppressHeader: false },
  prompt: { instructionLine: undefined, suppressHeader: true },
}

/**
 * The self-validation instruction appended to a `prompt` beat's plain output
 * only — a structured (`--json`) driver runs the `validate` field
 * itself instead. Advisory either way: `gtd land` refuses a turn whose
 * steering file is invalid regardless of whether this was followed.
 */
const selfValidateInstruction = (command: string, file: string): string =>
  `\nBefore finishing your turn, run \`${command}\` — it checks ${file} — and fix ` +
  `every violation it reports until it exits cleanly. Do not finish while it ` +
  `still reports violations.\n`

/**
 * `gtd next`'s plain-text encoding, driven by `DEMAND_BRIEFING`. At
 * `kind === "prompt"` the status header is suppressed and only `content`
 * plus the self-validation instruction is emitted — those bytes ARE the
 * agent's input, so gtd's own bookkeeping (state name, edges, pending
 * changes) must not be prefixed onto it. Every other kind gets the header
 * plus its instruction line, since its plain output is read by a human or
 * driver, never an agent. `selfValidateCommand` is already resolved; this
 * function never resolves it itself.
 */
export const renderBeatPlain = (document: BeatDocument, selfValidateCommand?: string): string => {
  const content = document.content.endsWith("\n") ? document.content : document.content + "\n"
  const briefing = DEMAND_BRIEFING[document.kind]
  if (briefing.suppressHeader) {
    return selfValidateCommand !== undefined && document.file !== undefined
      ? content + selfValidateInstruction(selfValidateCommand, document.file)
      : content
  }
  const body = beatHeaderLines(document).join("\n") + "\n\n" + content
  return briefing.instructionLine !== undefined ? `${briefing.instructionLine}\n` + body : body
}
