/**
 * The beat document: the ONE place the wire shape of `gtd next --json`'s
 * output lives. PURE — no git, no filesystem, no Effect; `program.ts`
 * gathers everything this module needs (a rendered rest, the derived
 * `stalled` verdict, an optional prompt session/validate script) and hands
 * it here to assemble the JSON line a driver polls.
 *
 * `BeatKind` supersedes the old boolean `stalled` field: it's the one
 * question a driver asks per beat — what to DO with this rest, not merely
 * whether dispatching it is safe. `beatKindOf` derives it in precedence
 * order (see its own doc comment); `beatDocument` renders the kind plus the
 * rendered rest's own fields into the document, gating the "dispatch block"
 * (`session`/`validate`) to `kind === "prompt"` alone.
 */
import type { RenderedRest } from "./Edge.js"
import type { Actor, ContentKind, StateName } from "./PatternMachine.js"

/** The whole beat vocabulary a driver acts on — see the module doc comment. */
export type BeatKind = "capture" | "message" | "script" | "prompt" | "stalled"

/**
 * A resting content kind: `renderRest` never resolves a `Rest` at a commit
 * state, so `beatKindOf` is never handed `"commit"` — narrowing the
 * parameter here (rather than switching on all four `ContentKind`s) makes
 * that case unwritable instead of merely untested.
 */
type RestingContentKind = Exclude<ContentKind, "commit">

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
 * The `stalled` beat's own content: a diagnosis naming the stuck state and
 * the three ways out. The first line is shaped so a stderr grep for
 * `stalled at "<state>"` stays a stable substring (see
 * `tests/integration/features/readme-driver.feature`).
 */
export const stallDiagnosis = (state: StateName, actor: Actor): string =>
  `stalled at "${state}": the last gtd(${actor}): ${state} turn landed an empty ` +
  `attempt, the tree is clean, and another dispatch would repeat it.\n\n` +
  `Three ways out:\n` +
  `  - sharpen the state's prompt so the turn has something concrete to author\n` +
  `  - give the state a retry: cap, redirecting to an escalation state after\n` +
  `    N fruitless attempts\n` +
  `  - declare a "C" pattern on the state, if it can legitimately finish with\n` +
  `    nothing to change\n`

/**
 * Assemble one beat document line — the newline-terminated JSON `gtd next
 * --json` prints. Key order is the emitted order: `kind`, `content`,
 * `session`, `model`, `validate`, `log`, `state`, `actor`, `label`,
 * `memory`, `file`, `mode`, `edges`.
 *
 * `session`/`validate` are the DISPATCH BLOCK: dropped unless `kind ===
 * "prompt"`, even if the caller passed one in — the gate lives here (not
 * only in the caller that computes them) so it can never drift. `content` is
 * the rendered rest's own content, except at `kind === "stalled"`, where
 * it's `stallDiagnosis`'s text instead. `model`/`memory`/`file`/`mode`/
 * `label`/`edges` are plain facts about the resting state and are emitted at
 * EVERY kind — the same discipline the old `nextJsonOutput` had: omitted
 * (never `null`) when their source is unset.
 */
export const beatDocument = (input: {
  readonly rendered: RenderedRest
  readonly kind: BeatKind
  readonly log: string
  readonly session?: { readonly id: string; readonly resume: boolean }
  readonly validate?: string
}): string => {
  const { rendered, kind, log, session, validate } = input
  const dispatchable = kind === "prompt"
  return (
    JSON.stringify({
      kind,
      content:
        kind === "stalled" ? stallDiagnosis(rendered.state, rendered.actor) : rendered.content,
      ...(dispatchable && session !== undefined
        ? { session: { id: session.id, resume: session.resume } }
        : {}),
      ...(rendered.model !== undefined ? { model: rendered.model } : {}),
      ...(dispatchable && validate !== undefined ? { validate } : {}),
      log,
      state: rendered.state,
      actor: rendered.actor,
      ...(rendered.label !== undefined ? { label: rendered.label } : {}),
      ...(rendered.memory !== undefined ? { memory: rendered.memory } : {}),
      ...(rendered.file !== undefined ? { file: rendered.file } : {}),
      ...(rendered.mode !== undefined ? { mode: rendered.mode } : {}),
      ...(rendered.edges.length > 0 ? { edges: rendered.edges } : {}),
    }) + "\n"
  )
}
