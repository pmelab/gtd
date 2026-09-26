import type { Actor, ContentKind, RenderedDemandSource, StateName } from "./types.js"

/** The whole beat vocabulary a driver acts on — what to DO with a rest, not merely whether dispatching it is safe. */
export type BeatKind = "capture" | "message" | "script" | "prompt" | "stalled"

/**
 * `BeatKind`'s own member list, as a value — the ONE place the five kinds are
 * enumerated. Every test that needs to loop "every kind" (the JSON document,
 * `DEMAND_BRIEFING`, the plain header) imports this instead of re-typing its
 * own `as const satisfies readonly BeatKind[]` literal, so the type and the
 * loop can never drift apart.
 */
export const BEAT_KINDS: readonly BeatKind[] = ["capture", "message", "script", "prompt", "stalled"]

/**
 * A resting content kind: `renderRest` never resolves a `Rest` at a commit
 * state, so `beatKindOf` is never handed `"commit"` — narrowing the
 * parameter here (rather than switching on all four `ContentKind`s) makes
 * that case unwritable instead of merely untested.
 */
export type RestingContentKind = Exclude<ContentKind, "commit">

/**
 * The beat kind for a rest, in precedence order:
 *
 * 1. `stalled` — `Edge.ts`'s `stalledAt` verdict, passed in as a plain
 *    boolean (this module never resolves it itself). `stalledAt` already
 *    requires a clean tree, so this can never collide with `capture` below.
 * 2. `capture` — a `message` rest with a DIRTY tree: the human already
 *    acted; a driver lands it immediately.
 * 3. Otherwise, the content kind verbatim (`script`/`prompt`, or `message`
 *    on a clean tree).
 */
export const beatKindOf = (input: {
  readonly contentKind: RestingContentKind
  readonly dirty: boolean
  readonly stalled: boolean
}): BeatKind => {
  if (input.stalled) return "stalled"
  if (input.contentKind === "message" && input.dirty) return "capture"
  return input.contentKind
}

/**
 * The `stalled` beat's own content: a diagnosis naming the stuck step and
 * the ways out. The first line is shaped so a stderr grep for
 * `stalled at "<state>"` stays a stable substring (see
 * `tests/integration/features/driver-doc.feature`).
 */
export const stallDiagnosis = (state: StateName, actor: Actor): string =>
  `stalled at "${state}": the last gtd(${actor}): ${state} turn landed an empty ` +
  `attempt, the tree is clean, and another dispatch would repeat it.\n\n` +
  `Two ways out:\n` +
  `  - sharpen the step's prompt so the turn has something concrete to author\n` +
  `  - pass allowEmpty: true to the step, so an empty turn completes it and the\n` +
  `    flow decides what follows — finishing, or an escalation step after N\n` +
  `    empty turns\n`

/** One dispatch session — `resume`'s own meaning lives with `src/Sessions.ts`'s `resolveSession`, which produces it. */
export interface DemandSession {
  readonly id: string
  readonly resume: boolean
}

/**
 * One driver `case` arm's whole demand: what to DO, and (only at `prompt`)
 * the dispatch bookkeeping (`session`/`validate`) no other kind carries.
 * Replaces `BeatFields`' flat `session`/`validate` fields (gated at
 * `kind === "prompt"` by a runtime check) with a shape where a non-`prompt`
 * variant cannot HOLD a session at all.
 */
export type Demand =
  | { readonly kind: "capture"; readonly content: string }
  | { readonly kind: "message"; readonly content: string }
  | { readonly kind: "script"; readonly content: string }
  | { readonly kind: "stalled"; readonly content: string }
  | {
      readonly kind: "prompt"
      readonly content: string
      readonly session: DemandSession | undefined
      readonly validate: string | undefined
    }

/**
 * Assemble one `Demand` — the ONLY place a rest's resolved content becomes
 * `Demand.content` (`stallDiagnosis` at `kind === "stalled"`, the rendered
 * content otherwise), and the only place `session`/`validate` are attached,
 * which the `prompt` variant's own type makes impossible to do at any other
 * kind.
 */
export const demandOf = (input: {
  readonly rendered: Pick<RenderedDemandSource, "actor" | "content" | "state">
  readonly kind: BeatKind
  readonly session?: DemandSession
  readonly validate?: string
}): Demand => {
  const { rendered, kind, session, validate } = input
  const content =
    kind === "stalled" ? stallDiagnosis(rendered.state, rendered.actor) : rendered.content
  return kind === "prompt" ? { kind, content, session, validate } : { kind, content }
}
