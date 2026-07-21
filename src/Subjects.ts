/**
 * The commit-subject grammar: the sole channel by which the machine steers
 * the split `gtd step` / `gtd step-agent` / `gtd next` commands.
 *
 * The machine derives everything it needs from HEAD alone by reading the
 * **subject line** of the last commit: (a) who authored the last turn (human
 * or agent), (b) whether that commit is the rest of a chain or mid-chain
 * bookkeeping, and (c) which workflow state it belongs to. The grammar is
 * **one label vocabulary** — every workflow commit names the state it enters
 * — written under two namespaces:
 *
 * - **Turn commits** — `gtd(human): <gate>` / `gtd(agent): <gate>`, authored
 *   by `gtd step` / `gtd step-agent` as the *first* commit of a chain. The
 *   `<gate>` names the workflow gate (state) the turn responded to (see
 *   `TurnGate` for the closed set).
 * - **Machine commits** — bare `gtd: <state>`, authored by the machine itself
 *   as bookkeeping between turns. Each label names the state the machine
 *   entered by writing it (`gtd: building` after consuming the architecture,
 *   `gtd: await-review` after publishing the review record), so `git log
 *   --oneline` reads as a state trace. Two labels are **marker states** —
 *   `gtd: tests-green` and `gtd: test-failed` record a check outcome whose
 *   next state is decided by guarded rules at resolution. See
 *   `RoutingPhase` / `ROUTING_SUBJECT` for the closed set, plus the
 *   parameterized `gtd: review <hash>` anchor.
 *
 * Everything else — any non-`gtd` subject, and any `gtd: *` subject outside
 * the closed label set above — is a **boundary commit**. This is also how
 * the grammar stays backward compatible with older histories: v1 subjects
 * (`gtd: new task`, `gtd: feedback`, `gtd: transport`, a bare
 * `gtd: reviewing` without a hash) AND the pre-label v2 routing subjects
 * (`gtd: planning`, `gtd: tests green`, `gtd: errors`, `gtd: package done`,
 * `gtd: awaiting review`, `gtd: review feedback`, `gtd: squash template`,
 * `gtd: reviewing <hash>`, `gtd: health-fix`, `gtd: learning template`, …)
 * all fall outside the closed set, so they parse as inert boundary commits
 * rather than errors. `parseSubject` is total: it never throws, and every
 * input subject maps to exactly one of `"turn"`, `"routing"`, or
 * `"boundary"`.
 *
 * This module is intentionally pure — no git, no filesystem, no Effect — so
 * the grammar is trivially unit-testable and safe to import from both the
 * workflow definition (`Workflow.ts`), the pure resolver (`Machine.ts`), and
 * the IO edge (`Events.ts`).
 */

import { isDefinedActor } from "./Workflow.js"

/**
 * Who authored a turn commit — the name of a declared actor. Actors are
 * **definition data**, not a hard-coded pair: the default workflow declares
 * `human` and `agent` (`defaultWorkflow.actors` in `./Workflow.js`), and the
 * grammar's closed actor vocabulary derives from that declaration. A subject
 * naming an undeclared actor parses as a boundary commit, keeping the
 * closed-world rule intact.
 */
export type Actor = string

/** The closed set of gate labels a turn commit can carry. */
export type TurnGate =
  | "grilling"
  | "architecting"
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

/** `gtd(${actor}): ${gate}` — the subject `gtd step <actor>` writes. */
export const turnSubject = (actor: Actor, gate: TurnGate): string => `gtd(${actor}): ${gate}`

/**
 * The closed set of machine-commit labels (state names the machine can
 * author as bookkeeping). Each names the state the commit enters;
 * `tests-green` / `test-failed` are the two marker states recording a check
 * outcome.
 */
export type RoutingPhase =
  | "architecting"
  | "grilled"
  | "building"
  | "tests-green"
  | "test-failed"
  | "close-package"
  | "await-review"
  | "grilling"
  | "done"
  | "squashing"
  | "review"
  | "health-check"
  | "testing"
  | "learning"
  | "await-learning-review"
  | "learning-apply"
  | "learning-applied"

/** Literal subjects for the non-parameterized machine labels. */
export const ROUTING_SUBJECT: Record<Exclude<RoutingPhase, "review">, string> = {
  architecting: "gtd: architecting",
  grilled: "gtd: grilled",
  building: "gtd: building",
  "tests-green": "gtd: tests-green",
  "test-failed": "gtd: test-failed",
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
 * v1 or pre-label v2 — outside the closed label set.
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

const TURN_GATES: ReadonlySet<string> = new Set<TurnGate>([
  "grilling",
  "architecting",
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

const ROUTING_SUBJECT_TO_PHASE: ReadonlyMap<string, Exclude<RoutingPhase, "review">> = new Map(
  Object.entries(ROUTING_SUBJECT).map(([phase, subject]) => [
    subject,
    phase as Exclude<RoutingPhase, "review">,
  ]),
)

const REVIEW_ANCHOR_RE = /^gtd: review ([0-9a-f]{40})$/

/**
 * Total classifier from a raw commit subject line to a `ParsedSubject`. Never
 * throws — any input that doesn't match the turn grammar or one of the closed
 * machine labels (including legacy v1 and pre-label v2 subjects, per the
 * compat rule documented at the top of this module) falls through to
 * `"boundary"`. Trims the input's surrounding whitespace before matching.
 */
export const parseSubject = (subject: string): ParsedSubject => {
  const trimmed = subject.trim()

  const turnMatch = TURN_RE.exec(trimmed)
  if (turnMatch) {
    const actor = turnMatch[1]
    const gate = turnMatch[2]
    // Both halves are closed-world: the actor must be declared by the active
    // definition and the gate must be in the closed gate set — anything else
    // is an inert boundary commit, never a guess.
    if (
      actor !== undefined &&
      isDefinedActor(actor) &&
      gate !== undefined &&
      TURN_GATES.has(gate)
    ) {
      return { kind: "turn", actor, gate: gate as TurnGate }
    }
    return { kind: "boundary" }
  }

  const routingPhase = ROUTING_SUBJECT_TO_PHASE.get(trimmed)
  if (routingPhase) {
    return { kind: "routing", phase: routingPhase }
  }

  const anchorMatch = REVIEW_ANCHOR_RE.exec(trimmed)
  const hash = anchorMatch?.[1]
  if (hash) {
    return { kind: "routing", phase: "review", param: hash }
  }

  return { kind: "boundary" }
}

/** True for any recognized turn or machine-label subject (kind !== "boundary"). */
export const isWorkflowSubject = (subject: string): boolean =>
  parseSubject(subject).kind !== "boundary"
