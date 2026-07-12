/**
 * The v2 commit-subject grammar: the sole channel by which the machine steers
 * the split `gtd step` / `gtd step-agent` / `gtd next` commands.
 *
 * The v2 machine derives everything it needs from HEAD alone by reading the
 * **subject line** of the last commit: (a) who authored the last turn (human
 * or agent), (b) whether that commit is the rest of a chain or mid-chain
 * bookkeeping, and (c) which phase of the workflow it belongs to. There are
 * exactly two machine-authored namespaces:
 *
 * - **Turn commits** — `gtd(human): <gate>` / `gtd(agent): <gate>`, authored
 *   by `gtd step` / `gtd step-agent` as the *first* commit of a chain. The
 *   `<gate>` names the workflow gate the turn responded to (see `TurnGate`
 *   for the closed set).
 * - **Routing commits** — bare `gtd: <phase>`, authored by the machine itself
 *   as bookkeeping between turns (see `RoutingPhase` / `ROUTING_SUBJECT` for
 *   the closed set, plus the parameterized `gtd: reviewing <hash>` anchor).
 *
 * Everything else — any non-`gtd` subject, and any `gtd: *` subject outside
 * the closed routing set above — is a **boundary commit**. This is also how
 * v2 stays backward compatible with v1 history: the old v1 taxonomy subjects
 * (`gtd: new task`, `gtd: grilling`, `gtd: building`, `gtd: fixing`,
 * `gtd: feedback`, `gtd: transport`, and a bare `gtd: reviewing` without a
 * hash) all fall outside the v2 closed sets, so they parse as inert boundary
 * commits rather than errors. `parseSubject` is total: it never throws, and
 * every input subject maps to exactly one of `"turn"`, `"routing"`, or
 * `"boundary"`.
 *
 * This module is intentionally pure — no git, no filesystem, no Effect — so
 * the grammar is trivially unit-testable and safe to import from both the
 * pure resolver (`Machine.ts`) and the IO edge (`Events.ts`).
 */

/** Who authored a turn commit. */
export type Actor = "human" | "agent"

/** The closed set of gate labels a turn commit can carry. */
export type TurnGate =
  | "grilling"
  | "grilled"
  | "building"
  | "fixing"
  | "agentic-review"
  | "review"
  | "squashing"
  | "health-fixing"
  | "escalate"
  | "learning"
  | "learning-apply"

/** `gtd(${actor}): ${gate}` — the subject `gtd step`/`gtd step-agent` write. */
export const turnSubject = (actor: Actor, gate: TurnGate): string => `gtd(${actor}): ${gate}`

/** The closed set of routing phases the machine can author as bookkeeping. */
export type RoutingPhase =
  | "grilled"
  | "planning"
  | "tests-green"
  | "errors"
  | "package-done"
  | "awaiting-review"
  | "review-feedback"
  | "done"
  | "squash-template"
  | "reviewing"
  | "health-check"
  | "health-fix"
  | "learning-template"
  | "learning-drafted"
  | "learning-approved"
  | "learning-applied"

/** Literal subjects for the non-parameterized routing phases. */
export const ROUTING_SUBJECT: Record<Exclude<RoutingPhase, "reviewing">, string> = {
  grilled: "gtd: grilled",
  planning: "gtd: planning",
  "tests-green": "gtd: tests green",
  errors: "gtd: errors",
  "package-done": "gtd: package done",
  "awaiting-review": "gtd: awaiting review",
  "review-feedback": "gtd: review feedback",
  done: "gtd: done",
  "squash-template": "gtd: squash template",
  "health-check": "gtd: health-check",
  "health-fix": "gtd: health-fix",
  "learning-template": "gtd: learning template",
  "learning-drafted": "gtd: learning drafted",
  "learning-approved": "gtd: learning approved",
  "learning-applied": "gtd: learning applied",
}

/** `gtd: reviewing ${baseHash}` — the ad-hoc review anchor. */
export const reviewingSubject = (baseHash: string): string => `gtd: reviewing ${baseHash}`

/**
 * The result of classifying a commit subject. `"boundary"` covers both
 * ordinary non-`gtd` subjects and (per the v2 compat rule) any legacy v1
 * `gtd: *` subject outside the closed routing set.
 */
export type ParsedSubject =
  | { readonly kind: "turn"; readonly actor: Actor; readonly gate: TurnGate }
  | {
      readonly kind: "routing"
      readonly phase: RoutingPhase
      readonly param?: string
    }
  | { readonly kind: "boundary" }

const TURN_RE = /^gtd\((human|agent)\): (.+)$/

const TURN_GATES: ReadonlySet<string> = new Set<TurnGate>([
  "grilling",
  "grilled",
  "building",
  "fixing",
  "agentic-review",
  "review",
  "squashing",
  "health-fixing",
  "escalate",
  "learning",
  "learning-apply",
])

const ROUTING_SUBJECT_TO_PHASE: ReadonlyMap<string, Exclude<RoutingPhase, "reviewing">> = new Map(
  Object.entries(ROUTING_SUBJECT).map(([phase, subject]) => [
    subject,
    phase as Exclude<RoutingPhase, "reviewing">,
  ]),
)

const REVIEWING_RE = /^gtd: reviewing ([0-9a-f]{40})$/

/**
 * Total classifier from a raw commit subject line to a `ParsedSubject`. Never
 * throws — any input that doesn't match the turn grammar or one of the closed
 * routing subjects (including legacy v1 subjects, per the compat rule
 * documented at the top of this module) falls through to `"boundary"`. Trims
 * the input's surrounding whitespace before matching.
 */
export const parseSubject = (subject: string): ParsedSubject => {
  const trimmed = subject.trim()

  const turnMatch = TURN_RE.exec(trimmed)
  if (turnMatch) {
    const actor = turnMatch[1]
    const gate = turnMatch[2]
    if (gate !== undefined && TURN_GATES.has(gate)) {
      return { kind: "turn", actor: actor as Actor, gate: gate as TurnGate }
    }
    return { kind: "boundary" }
  }

  const routingPhase = ROUTING_SUBJECT_TO_PHASE.get(trimmed)
  if (routingPhase) {
    return { kind: "routing", phase: routingPhase }
  }

  const reviewingMatch = REVIEWING_RE.exec(trimmed)
  const hash = reviewingMatch?.[1]
  if (hash) {
    return { kind: "routing", phase: "reviewing", param: hash }
  }

  return { kind: "boundary" }
}

/** True for any recognized v2 turn or routing subject (kind !== "boundary"). */
export const isWorkflowSubject = (subject: string): boolean =>
  parseSubject(subject).kind !== "boundary"
