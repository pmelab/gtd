import type {
  SteeringAction,
  SteeringFormat,
  SteeringLink,
  SteeringOutlineNode,
  SteeringPointer,
} from "./SteeringFormat.js"
import { qaDescriptor } from "./qa.js"
import { reviewDescriptor } from "./review.js"
import { findingsDescriptor } from "./findings.js"
// The free-form format: the mode-less/unregistered-mode FALLBACK —
// deliberately not a `REGISTRY` entry of its own, since it is never a mode a
// `mode:` key names.
import { freeFormFormat } from "./freeform.js"

/** The built-in registry: mode name → its format, in registry order. The single place the built-in formats are wired into names — everything else in this module dispatches over a resolved `SteeringFormat`, never a mode-name string. */
const REGISTRY: ReadonlyMap<string, SteeringFormat> = new Map([
  ["qa", qaDescriptor],
  ["review", reviewDescriptor],
  ["findings", findingsDescriptor],
])

/** Every built-in format name, in registry order. */
export const BUILT_IN_MODE_NAMES: readonly string[] = [...REGISTRY.keys()]

/** The built-in `SteeringFormat` registered under `mode`'s name, or `undefined` when it isn't a built-in mode at all. The one place a bare mode-name string is ever looked up — every consumer takes the RESOLVED value this returns, never a name, so "mode is required, never inferred from a file's basename" is a type, not a rule to remember. */
export const steeringFormatFor = (mode: string): SteeringFormat | undefined => REGISTRY.get(mode)

/**
 * The ui boundary's own resolution: `mode`'s registered format, or
 * `freeFormFormat` when `mode` is absent or names nothing in `REGISTRY` —
 * never `undefined`. `resolveMode` (`SteeringMode.ts`) stays on
 * `steeringFormatFor` alone, so a workflow naming a mode nothing defines
 * still fails to compile; this fallback is deliberately reachable only from
 * `src/ui/View.ts` and `src/ui/Write.ts`, where a mode-less/unknown-mode
 * document must still render and accept a paragraph note, never refuse.
 */
export const steeringFormatOrFreeForm = (mode: string | undefined): SteeringFormat =>
  (mode !== undefined ? REGISTRY.get(mode) : undefined) ?? freeFormFormat

/**
 * `qa`-only: every OPEN question in `content` not yet answered, as
 * `{ question, headingLine }` pairs — enough for a refusal message ("which
 * question", "where"). Semantically distinct from `validate`'s findings:
 * a document can be perfectly well-formed (zero findings) while still having
 * open questions nobody has answered, which is the whole point of the
 * answer-completeness gate this feeds. Format-parameterised like everything
 * else here: `review` (or any future format with no such concept) yields
 * `[]` rather than this being a `qa`-specific function some caller has to
 * know not to call on the wrong format.
 */
export const unansweredQuestions = (
  format: SteeringFormat,
  content: string,
): readonly { readonly question: string; readonly headingLine: number }[] =>
  format.unansweredQuestions?.(content) ?? []

/**
 * Every positional thing an editor (the LSP, in a later pass) needs for one
 * document, off ONE `viewOf` call rather than four separate ones re-deriving
 * ranges each time: `outline` and `documentLinks` are already fully resolved
 * (each node/link carries its own range — see `SteeringOutlineNode`/
 * `SteeringLink`), while `pointerAt`/`actionsAt` stay closures over `content`
 * because they need a cursor position/selection range the caller supplies
 * per request. `Lsp.ts` reads its ranges straight off `outline`/`documentLinks`.
 */
export interface SteeringEditorView {
  readonly outline: readonly SteeringOutlineNode[]
  readonly documentLinks: readonly SteeringLink[]
  readonly pointerAt: (position: {
    readonly line: number
    readonly character: number
  }) => SteeringPointer | undefined
  readonly actionsAt: (range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }) => readonly SteeringAction[]
}

/** Builds `format`'s `SteeringEditorView` of `content` — see `SteeringEditorView`'s own doc for why this is one value, not several. Distinct from `SteeringView` (`SteeringFormat.ts`), which is the format's own node tree the phone client renders. */
export const viewOf = (format: SteeringFormat, content: string): SteeringEditorView => ({
  outline: format.outline(content),
  documentLinks: format.documentLinks ? format.documentLinks(content) : [],
  pointerAt: (position) => format.pointerAt?.(content, position),
  actionsAt: (range) => format.actions(content, range),
})

/** Every OPEN thread — last entry is the agent's — as `{ name, line, firstMe }` (0-based line). `[]` for a format with no thread concept. */
export const openThreads = (
  format: SteeringFormat,
  content: string,
): readonly { readonly name: string; readonly line: number; readonly firstMe: string }[] =>
  format.openThreads?.(content) ?? []
