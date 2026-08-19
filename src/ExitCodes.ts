/**
 * The whole exit-code vocabulary a turn owner (a driver, or a human at a
 * terminal) reads off gtd's process exit — CLOSED at these seven numbers, one
 * per row of the table this module IS:
 *
 * | Code      | Meaning                          |
 * | --------- | -------------------------------- |
 * | 0         | terminal success — nothing to do |
 * | 10        | needs an agent turn              |
 * | 20        | needs a human turn               |
 * | 1         | runtime error                    |
 * | 2         | usage error                      |
 * | 130 / 143 | SIGINT / SIGTERM                  |
 *
 * PURE const data plus a total function of `BeatKind` — no git, no Effect, no
 * filesystem, in the same tier as `StateFields.ts`. `ownerCodeOf` is the only
 * behavior: which of the two OWNER codes (10 agent, 20 human) a beat kind
 * maps to. Adding a workflow state never grows this table — a new state maps
 * onto an existing `BeatKind` (see `Beat.ts`'s `beatKindOf`), and `ownerCodeOf`
 * is already total over the five kinds that exist. No code here encodes a
 * state name or a gate class; `restExitCode` folds in the one remaining
 * fact a caller needs — whether the rest is the workflow's idle rest — as a
 * plain boolean, never a name.
 */
import type { BeatKind } from "./Beat.js"

/** Terminal success — nothing owed, nothing to do. */
export const EXIT_OK = 0
/** An agent owes the next turn (`script`/`prompt` beats). */
export const EXIT_AGENT_TURN = 10
/** A human owes the next turn (`capture`/`message`/`stalled` beats). */
export const EXIT_HUMAN_TURN = 20
/** Something failed that was never a matter of how gtd was invoked — a refusal or an unexpected error. */
export const EXIT_RUNTIME_ERROR = 1
/** gtd was invoked wrong — an unknown option/command, bad arity, a scope violation, a decode failure. */
export const EXIT_USAGE_ERROR = 2
/** The process was interrupted (Ctrl-C). */
export const EXIT_SIGINT = 130
/** The process was asked to terminate. */
export const EXIT_SIGTERM = 143

/** Every code this module recognizes — the CLOSURE claim a test pins against. */
export const EXIT_CODES: ReadonlySet<number> = new Set([
  EXIT_OK,
  EXIT_AGENT_TURN,
  EXIT_HUMAN_TURN,
  EXIT_RUNTIME_ERROR,
  EXIT_USAGE_ERROR,
  EXIT_SIGINT,
  EXIT_SIGTERM,
])

/**
 * Which OWNER a beat kind names — 10 (agent) for `script`/`prompt`, 20
 * (human) for `capture`/`message`/`stalled`. Total over `BeatKind`'s five
 * members; TypeScript's exhaustiveness check on the switch is what keeps a
 * sixth beat kind (there is none today) from compiling silently unmapped.
 */
export const ownerCodeOf = (kind: BeatKind): number => {
  switch (kind) {
    case "script":
    case "prompt":
      return EXIT_AGENT_TURN
    case "capture":
    case "message":
    case "stalled":
      return EXIT_HUMAN_TURN
  }
}

/**
 * The exit code for a resolved rest: `EXIT_OK` when `idle` (the workflow's
 * initial state with nothing pending — the one shape that means "the process
 * is done"), otherwise `ownerCodeOf(kind)`. A pure function of exactly these
 * two facts — never the state's name, never which gate produced the rest —
 * so `next`, `status`, and `land` (each computing `idle` its own way, off a
 * different rest) all agree on the same table.
 */
export const restExitCode = (kind: BeatKind, idle: boolean): number =>
  idle ? EXIT_OK : ownerCodeOf(kind)
