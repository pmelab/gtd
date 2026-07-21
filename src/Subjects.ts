/**
 * The commit-subject grammar: the sole channel by which the machine steers
 * the split `gtd step <actor>` / `gtd next` commands.
 *
 * The machine derives everything it needs from HEAD alone by reading the
 * **subject line** of the last commit: (a) which declared actor authored the
 * last turn, (b) whether that commit is the rest of a chain or mid-chain
 * bookkeeping, and (c) which workflow state it belongs to. The grammar is
 * **one label vocabulary** — every workflow commit names the state it enters
 * — written under two namespaces:
 *
 * - **Turn commits** — `gtd(<actor>): <gate>`, authored by `gtd step <actor>`
 *   as the *first* commit of a chain. The `<gate>` names the workflow gate
 *   (state) the turn responded to.
 * - **Machine commits** — bare `gtd: <state>`, authored by the machine itself
 *   as bookkeeping between turns, plus the parameterized `gtd: review <hash>`
 *   anchor.
 *
 * The closed sets behind both namespaces are **definition data**: the actor
 * names, turn gates, and routing phases all derive from the ACTIVE workflow
 * definition (`activeWorkflow()` in `./Workflow.js` — the built-in default,
 * or one built up from the `.gtdrc` `workflow:` key). A subject naming an
 * undeclared actor, gate, or phase is a **boundary commit** — this is also
 * how the grammar stays backward compatible with older histories: v1
 * subjects and pre-label v2 routing subjects fall outside the active sets
 * and parse as inert boundary commits rather than errors. `parseSubject` is
 * total: it never throws, and every input subject maps to exactly one of
 * `"turn"`, `"routing"`, or `"boundary"`.
 *
 * This module is intentionally pure — no git, no filesystem, no Effect.
 */

import { activeWorkflow, type WorkflowDefinition } from "./Workflow.js"

/**
 * Who authored a turn commit — the name of a declared actor. Actors are
 * definition data, not a hard-coded set: the default workflow declares
 * `human`, `agent`, and `check`.
 */
export type Actor = string

/**
 * A gate label a turn commit can carry. The closed set is derived from the
 * active definition (capture-rule labels, turn-rule gates, entry gates).
 */
export type TurnGate = string

/** `gtd(${actor}): ${gate}` — the subject `gtd step <actor>` writes. */
export const turnSubject = (actor: Actor, gate: TurnGate): string => `gtd(${actor}): ${gate}`

/**
 * A machine-commit label (a state name the machine can author as
 * bookkeeping). The closed set is derived from the active definition's
 * routing-rule keys.
 */
export type RoutingPhase = string

/**
 * Literal subjects for the DEFAULT workflow's machine labels, kept as a
 * stable lookup for edge code with default-shaped concerns (e.g. the review
 * checkout window keys on `gtd: await-review` / `gtd: done`).
 */
export const ROUTING_SUBJECT: Record<string, string> = {
  architecting: "gtd: architecting",
  grilled: "gtd: grilled",
  building: "gtd: building",
  "tests-green": "gtd: tests-green",
  "test-failed": "gtd: test-failed",
  escalated: "gtd: escalated",
  "agentic-review": "gtd: agentic-review",
  "close-package": "gtd: close-package",
  "await-review": "gtd: await-review",
  grilling: "gtd: grilling",
  done: "gtd: done",
  squashing: "gtd: squashing",
  "health-check": "gtd: health-check",
  testing: "gtd: testing",
  learning: "gtd: learning",
  "await-learning-review": "gtd: await-learning-review",
  "learning-apply": "gtd: learning-apply",
  "learning-applied": "gtd: learning-applied",
}

/** `gtd: review ${baseHash}` — the ad-hoc review anchor. */
export const reviewingSubject = (baseHash: string): string => `gtd: review ${baseHash}`

/**
 * The result of classifying a commit subject. `"boundary"` covers ordinary
 * non-`gtd` subjects and (per the compat rule) any legacy `gtd: *` subject —
 * v1 or pre-label v2 — outside the active definition's closed sets.
 */
export type ParsedSubject =
  | { readonly kind: "turn"; readonly actor: Actor; readonly gate: TurnGate }
  | {
      readonly kind: "routing"
      readonly phase: RoutingPhase
      readonly param?: string
    }
  | { readonly kind: "boundary" }

const TURN_RE = /^gtd\(([a-z][a-z0-9-]*)\): (.+)$/

/**
 * The grammar's closed sets, derived from one definition: every declared
 * actor name; every gate a turn commit can carry (capture-rule labels,
 * turn-rule gates, entry gates, validation keys); every routing phase
 * (routing-rule keys). Cached per definition identity, so swapping the
 * active definition (the `.gtdrc` `workflow:` key) re-derives on first use.
 */
interface Grammar {
  readonly def: WorkflowDefinition
  readonly actors: ReadonlySet<string>
  readonly gates: ReadonlySet<string>
  readonly phases: ReadonlySet<string>
}

let grammarCache: Grammar | undefined

const deriveGrammar = (def: WorkflowDefinition): Grammar => {
  const gates = new Set<string>()
  for (const state of Object.values(def.states)) {
    for (const rule of state.captureRules ?? []) gates.add(rule.label)
  }
  for (const rule of def.turnRules) gates.add(rule.gate)
  for (const rule of def.entry) gates.add(rule.gate)
  for (const gate of Object.keys(def.agentTurnValidation)) gates.add(gate)
  const phases = new Set(Object.keys(def.routingRules))
  // "review" is the parameterized anchor's phase (`gtd: review <hash>`): a
  // BARE `gtd: review` is v1-shaped history and must stay a boundary, so the
  // phase never joins the literal-subject set.
  phases.delete("review")
  return {
    def,
    actors: new Set(def.actors.map((a) => a.name)),
    gates,
    phases,
  }
}

const grammar = (): Grammar => {
  const def = activeWorkflow()
  if (grammarCache === undefined || grammarCache.def !== def) {
    grammarCache = deriveGrammar(def)
  }
  return grammarCache
}

const REVIEW_ANCHOR_RE = /^gtd: review ([0-9a-f]{40})$/

/**
 * Total classifier from a raw commit subject line to a `ParsedSubject`. Never
 * throws — any input that doesn't match the turn grammar or one of the active
 * definition's labels (including legacy v1 and pre-label v2 subjects, per the
 * compat rule documented at the top of this module) falls through to
 * `"boundary"`. Trims the input's surrounding whitespace before matching.
 */
export const parseSubject = (subject: string): ParsedSubject => {
  const trimmed = subject.trim()
  const g = grammar()

  const turnMatch = TURN_RE.exec(trimmed)
  if (turnMatch) {
    const actor = turnMatch[1]
    const gate = turnMatch[2]
    // Both halves are closed-world: the actor must be declared by the active
    // definition and the gate must be in the derived gate set — anything else
    // is an inert boundary commit, never a guess.
    if (actor !== undefined && g.actors.has(actor) && gate !== undefined && g.gates.has(gate)) {
      return { kind: "turn", actor, gate }
    }
    return { kind: "boundary" }
  }

  if (trimmed.startsWith("gtd: ")) {
    const phase = trimmed.slice("gtd: ".length)
    if (g.phases.has(phase)) {
      return { kind: "routing", phase }
    }
    const anchorMatch = REVIEW_ANCHOR_RE.exec(trimmed)
    const hash = anchorMatch?.[1]
    if (hash) {
      return { kind: "routing", phase: "review", param: hash }
    }
  }

  return { kind: "boundary" }
}

/** True for any recognized turn or machine-label subject (kind !== "boundary"). */
export const isWorkflowSubject = (subject: string): boolean =>
  parseSubject(subject).kind !== "boundary"
