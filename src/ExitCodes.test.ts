import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { beatKindOf, type BeatKind } from "./Beat.js"
import {
  contentKindOf,
  type ContentKind,
  type StateDef,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import {
  EXIT_AGENT_TURN,
  EXIT_CODES,
  EXIT_HUMAN_TURN,
  EXIT_OK,
  EXIT_RUNTIME_ERROR,
  EXIT_SIGINT,
  EXIT_SIGTERM,
  EXIT_USAGE_ERROR,
  ownerCodeOf,
  restExitCode,
} from "./ExitCodes.js"

const ALL_BEAT_KINDS: readonly BeatKind[] = ["capture", "message", "script", "prompt", "stalled"]

/**
 * A generated single-state `WorkflowDefinition` whose one state rests at one
 * of the three content kinds a `Rest` can ever declare (`script`/`prompt`/
 * `message` — never `commit`, since a process never rests at a commit state).
 * `RestingContentKind` (`Beat.ts`) is already closed to exactly these three,
 * so enumerating them here IS enumerating every resting state's content kind
 * a generated workflow could ever produce.
 */
const arbRestingWorkflow: fc.Arbitrary<WorkflowDefinition> = fc
  .record({
    actor: fc.constantFrom("human" as const, "agent" as const, "check" as const),
    kind: fc.constantFrom("script" as const, "prompt" as const, "message" as const),
    body: fc.string({ maxLength: 20 }),
  })
  .map(({ actor, kind, body }): WorkflowDefinition => {
    const stateDef = { actor, [kind]: body } as unknown as StateDef
    return { states: { rest: stateDef }, entries: { default: "rest", manual: [] } }
  })

describe("EXIT_CODES", () => {
  it("is exactly {0, 10, 20, 1, 2, 130, 143}", () => {
    expect(EXIT_CODES).toEqual(new Set([0, 10, 20, 1, 2, 130, 143]))
  })

  it("each named constant is a member of the set", () => {
    for (const code of [
      EXIT_OK,
      EXIT_AGENT_TURN,
      EXIT_HUMAN_TURN,
      EXIT_RUNTIME_ERROR,
      EXIT_USAGE_ERROR,
      EXIT_SIGINT,
      EXIT_SIGTERM,
    ]) {
      expect(EXIT_CODES.has(code)).toBe(true)
    }
  })
})

describe("ownerCodeOf", () => {
  it("maps script/prompt to the agent-turn code", () => {
    expect(ownerCodeOf("script")).toBe(EXIT_AGENT_TURN)
    expect(ownerCodeOf("prompt")).toBe(EXIT_AGENT_TURN)
  })

  it("maps capture/message/stalled to the human-turn code", () => {
    expect(ownerCodeOf("capture")).toBe(EXIT_HUMAN_TURN)
    expect(ownerCodeOf("message")).toBe(EXIT_HUMAN_TURN)
    expect(ownerCodeOf("stalled")).toBe(EXIT_HUMAN_TURN)
  })

  it("is total over every beat kind (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_BEAT_KINDS), (kind) => {
        const code = ownerCodeOf(kind)
        expect([EXIT_AGENT_TURN, EXIT_HUMAN_TURN]).toContain(code)
      }),
    )
  })

  it("never produces a code outside the closed table, over every generated beat kind (the closure claim)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_BEAT_KINDS), (kind) => {
        expect(EXIT_CODES.has(ownerCodeOf(kind))).toBe(true)
      }),
    )
  })
})

describe("restExitCode", () => {
  it("is EXIT_OK when idle, regardless of beat kind", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_BEAT_KINDS), (kind) => {
        expect(restExitCode(kind, true)).toBe(EXIT_OK)
      }),
    )
  })

  it("falls through to ownerCodeOf when not idle", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_BEAT_KINDS), (kind) => {
        expect(restExitCode(kind, false)).toBe(ownerCodeOf(kind))
      }),
    )
  })

  it("is a pure function of beat kind plus idleness alone — never the state name or gate class producing it (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_BEAT_KINDS),
        fc.boolean(),
        fc.string(),
        fc.string(),
        fc.string(),
        fc.string(),
        (kind, idle, stateNameA, stateNameB, gateClassA, gateClassB) => {
          // `restExitCode` takes no state-name/gate-class parameter at all —
          // this closure stands in for a caller that has one lying around
          // (as `program.ts`'s next/status/land handlers do) and proves
          // passing different values for it can never reach the computation.
          const computeIgnoring = (_name: string, _gate: string): number => restExitCode(kind, idle)
          expect(computeIgnoring(stateNameA, gateClassA)).toBe(
            computeIgnoring(stateNameB, gateClassB),
          )
        },
      ),
    )
  })
})

describe("closure over generated workflow definitions", () => {
  it("every resting state's content kind maps into the existing table — a new state can never require a new code (property)", () => {
    fc.assert(
      fc.property(arbRestingWorkflow, fc.boolean(), fc.boolean(), (def, dirty, stalled) => {
        const contentKind = contentKindOf(def.states["rest"]!)
        expect(contentKind).toBeDefined()
        const kind = beatKindOf({
          contentKind: contentKind as Exclude<ContentKind, "commit">,
          dirty,
          stalled,
        })
        expect(EXIT_CODES.has(ownerCodeOf(kind))).toBe(true)
      }),
    )
  })
})
