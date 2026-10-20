import { human, refuse, scope, vars } from "../../flows/index.js"
import * as t from "./text.js"
import type { Handoff } from "./text.js"
import { defaults } from "./vars.js"

export type { Handoff }

export interface Turned<T> {
  readonly result: T
  /** Set when the turn wrote a handoff note, i.e. stopped at its context limit. */
  readonly handoff?: Handoff | undefined
}

/** Runs a turn's agent step in a conversation of its own, or in the caller's. */
export type Fresh = <T>(fn: () => Promise<T>) => Promise<T>

/**
 * One phase's continuations, shared by every `continuing()` call in it (a naive
 * retry, a refactor lap) so the caps hold per phase. `spent`: once a turn hit
 * its context limit, resuming that conversation would only hit it again.
 */
export interface Phase {
  readonly name: string
  spent: boolean
  count: number
  stalled: number
  /** Run after a landing at `oversized`, where a person may narrow the requirements; absent, the gate does not suggest it. */
  readonly steered?: (() => void) | undefined
}

export const phase = (name: string, steered?: () => void): Phase => ({
  name,
  spent: false,
  count: 0,
  stalled: 0,
  steered,
})

const own: Fresh = (fn) => fn()
// Every `scope()` call is a new conversation; the names keep continuations
// apart in history from later turns of a phase that merely start afresh.
const continued: Fresh = (fn) => scope("continue", fn)
const afresh: Fresh = (fn) => scope("fresh", fn)

const setting = (name: "continuations" | "continuationStall", least: number): number => {
  const raw = vars[name] ?? defaults[name]!
  const n = Number(raw)
  if (raw.trim() === "" || !Number.isInteger(n) || n < least)
    refuse(`gtd: ${name} must be a whole number of at least ${least}, got ${JSON.stringify(raw)}`)
  return n
}

/**
 * Run `turn` until one ends without a handoff note: each stopped turn is picked
 * up by a continuation in a fresh conversation. Past `continuations` of them in
 * the phase, or after `continuationStall` in a row that close nothing still
 * open, the phase rests at `oversized` for a person; landing there grants a new round.
 */
export const continuing = async <T>(
  phase: Phase,
  turn: (from: Handoff | undefined, fresh: Fresh) => Promise<Turned<T>>,
): Promise<T> => {
  const cap = setting("continuations", 0)
  const stall = setting("continuationStall", 1)
  let last = await turn(undefined, phase.spent ? afresh : own)
  while (last.handoff !== undefined) {
    phase.spent = true
    const from = last.handoff
    if (phase.count >= cap || phase.stalled >= stall) {
      await human("oversized", {
        message: t.oversizedMessage(
          phase.name,
          from,
          phase.count >= cap ? { cap } : { stall },
          phase.steered !== undefined,
        ),
        label: "Too big for its context",
        acceptClean: true,
      })
      phase.steered?.()
      phase.count = 0
      phase.stalled = 0
    }
    last = await turn(from, continued)
    phase.count++
    // Nothing countable left open is no stall: only the cap stops such a phase.
    const closed =
      from.open.length === 0 || from.open.some((item) => !(last.handoff?.open ?? []).includes(item))
    phase.stalled = closed ? 0 : phase.stalled + 1
  }
  return last.result
}
