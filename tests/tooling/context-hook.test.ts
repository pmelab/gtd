import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { decide, guardOf } from "../../claude/hooks/context.js"
import { runContextHook } from "../../src/hook/index.js"
import { inMemoryHookHost } from "../integration/support/hook-host.js"

// `gtd context-hook` and the mod's classic hooks, held to the same
// answers: each case is one hook event against a transcript at `tokens`, in a
// 1000-token window at the default limits.
const transcript = (tokens: number): string =>
  `${JSON.stringify({ type: "assistant", message: { usage: { input_tokens: tokens } } })}\n`

const MAIN = "/projects/session.jsonl"

// Each wiring's answer as the decision it carries: the CLI's settings-hook JSON,
// the mod's decision before it blocks the call and stops the worker.
type Outcome = { block?: string; stopReason?: string } | undefined

const viaCli = async (event: string, tokens: number): Promise<Outcome> => {
  const out = await Effect.runPromise(
    runContextHook({
      input: JSON.stringify({ hook_event_name: event, transcript_path: MAIN }),
      window: 1000,
    }).pipe(Effect.provide(inMemoryHookHost(new Map([[MAIN, transcript(tokens)]])))),
  )
  if (out === "") return undefined
  const json = JSON.parse(out) as { decision?: string; reason?: string; stopReason?: string }
  return json.decision === "block" ? { block: json.reason! } : { stopReason: json.stopReason! }
}

const viaMod = async (event: string, tokens: number): Promise<Outcome> => {
  const worker = "/projects/session/subagents/agent-w1.jsonl"
  const decision = await decide(
    { hook_event_name: event, transcript_path: MAIN, agent_id: "w1" },
    guardOf(undefined, undefined, "1000"),
    async (path) => (path === worker ? transcript(tokens) : undefined),
  )
  if (decision === undefined) return undefined
  return decision.kind === "soft" ? { block: decision.reason } : { stopReason: decision.stopReason }
}

describe.each([
  ["gtd context-hook", viaCli],
  ["the mod", viaMod],
])("the context-limit hook (%s)", (_, hook) => {
  it("lets a turn below the soft limit go on", async () => {
    expect(await hook("PostToolUse", 599)).toBeUndefined()
  })

  it("asks for a handoff note past the soft limit", async () => {
    expect((await hook("PostToolUse", 600))?.block).toContain("short handoff note")
  })

  it("stops the turn past the hard limit", async () => {
    expect(await hook("PostToolUse", 700)).toEqual({
      stopReason: "gtd: context limit: 700 of 1000 tokens, past the 70% hard limit",
    })
  })

  it("stops the turn when compaction is about to happen", async () => {
    expect((await hook("PreCompact", 10))?.stopReason).toMatch(
      /^gtd: context limit: the context is about to be compacted/,
    )
  })

  it("ignores any other event", async () => {
    expect(await hook("Stop", 900)).toBeUndefined()
  })
})
