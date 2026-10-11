import { Effect, Exit as EffectExit, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { WIRE_SCHEMA } from "../wire/index.js"
import { runLoop } from "./Loop.js"
import { LoopHost } from "./index.js"

interface Request {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly stdin?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly output: "capture" | { readonly log: string }
}
interface Result {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const LOG = "/repo/.git/gtd-loop.log"
const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" })

const beat = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    schema: WIRE_SCHEMA,
    content: "",
    idle: false,
    log: LOG,
    state: "s",
    ...fields,
  })
const landing = (fields: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: WIRE_SCHEMA,
    script: "echo landed",
    settled: false,
    idle: false,
    state: "s",
    subject: "gtd(agent): s → t",
    cost: null,
    model: null,
    ...fields,
  })
const envelope = (fields: Record<string, unknown>): string =>
  JSON.stringify({ result: "done", is_error: false, total_cost_usd: 0.1, ...fields })

const prompt = (fields: Record<string, unknown> = {}): string =>
  beat({
    kind: "prompt",
    state: "working",
    session: { id: "sid", resume: false },
    model: "smart",
    ...fields,
  })
const gate = (state = "gate"): string => beat({ kind: "message", state, content: "read me" })

interface Script {
  readonly beats: readonly string[]
  readonly lands?: readonly string[]
  readonly agent?: (request: Request) => Result
  readonly validate?: (attempt: number) => Result
  readonly script?: (request: Request) => Result
  readonly env?: Record<string, string>
  readonly files?: Record<string, string>
  readonly landScript?: Result
  readonly judge?: (request: Request) => Result
  readonly answer?: (request: Request) => Result
}

const fakeHost = (script: Script) => {
  const requests: Request[] = []
  let log = ""
  let said = ""
  let beats = 0
  let lands = 0
  let validations = 0
  const gtdVerbs: Record<string, (args: readonly string[], request: Request) => Result> = {
    next: ([json]) => {
      if (json !== "--json") return ok("PLAIN NEXT\n")
      const doc = script.beats[beats++]
      return doc === undefined ? { code: 1, stdout: "", stderr: "no more beats" } : ok(doc)
    },
    land: () => ok(script.lands?.[lands++] ?? landing()),
    judge: ([sub], request) =>
      sub === "answer"
        ? (script.answer?.(request) ?? ok(script.lands?.[lands++] ?? landing()))
        : (script.judge?.(request) ?? { code: 1, stdout: "", stderr: "no judge configured" }),
  }
  const gtd = (request: Request): Result => {
    const [verb = "", ...rest] = request.args.slice(1)
    const handle = gtdVerbs[verb]
    if (handle === undefined) throw new Error(`unexpected gtd ${request.args.join(" ")}`)
    return handle(rest, request)
  }
  // `sh` arity tells the three apart: `-c <script>` runs a script beat, the
  // validate wrapper passes four args, and a landing script arrives on stdin.
  const sh = (request: Request): Result => {
    if (request.args.length === 4) return script.validate?.(validations++) ?? ok()
    if (request.args.length === 0) return script.landScript ?? ok()
    return script.script?.(request) ?? ok()
  }
  const respond = (request: Request): Result => {
    if (request.command === "git") return ok("/repo\n")
    if (request.command === "node") return gtd(request)
    if (request.command === "sh") return sh(request)
    return script.agent?.(request) ?? ok(envelope({}))
  }
  const layer = Layer.succeed(LoopHost, {
    env: script.env ?? { HOME: "/home/me" },
    color: false,
    spawn: (request) =>
      Effect.sync(() => {
        requests.push(request)
        return respond(request)
      }),
    readFile: (path) => Effect.succeed(script.files?.[path]),
    resetLog: (path) =>
      Effect.sync(() => {
        log = `<reset ${path}>`
      }),
    appendLog: (_path, text) =>
      Effect.sync(() => {
        log += text
      }),
    say: (text) =>
      Effect.sync(() => {
        said += text
      }),
  })
  const run = () =>
    Effect.runPromiseExit(runLoop({ gtd: ["node", "/gtd.mjs"] }).pipe(Effect.provide(layer)))
  return {
    run,
    requests,
    log: () => log,
    said: () => said,
    agentCalls: () => requests.filter((r) => r.command === "claude" || r.command === "pi"),
    landCalls: () =>
      requests.filter((r) => r.command === "node" && r.args[1] === "land").map((r) => r.args),
    judgeCalls: () =>
      requests.filter((r) => r.command === "node" && r.args[1] === "judge" && r.args[2] === "run"),
    answerCalls: () =>
      requests.filter(
        (r) => r.command === "node" && r.args[1] === "judge" && r.args[2] === "answer",
      ),
    landScripts: () => requests.filter((r) => r.command === "sh" && r.args.length === 0),
  }
}

const failure = (exit: EffectExit.Exit<void, Error>): string =>
  EffectExit.match(exit, {
    onSuccess: () => "",
    onFailure: (cause) => {
      const error = cause._tag === "Fail" ? cause.error : undefined
      return error?.message ?? String(cause)
    },
  })

describe("runLoop", () => {
  it("drives an agent turn, lands it, and stops at the gate the run produced", async () => {
    const h = fakeHost({ beats: [prompt(), gate()] })
    const exit = await h.run()
    expect(EffectExit.isSuccess(exit)).toBe(true)
    const [turn] = h.agentCalls()
    expect(turn?.args).toEqual([
      "-p",
      "--session-id",
      "sid",
      "--model",
      "opus",
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
    ])
    expect(turn?.stdin).toBe("PLAIN NEXT\n")
    expect(turn?.cwd).toBe("/repo")
    expect(turn?.env).toEqual({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" })
    expect(h.landScripts()[0]?.stdin).toBe("echo landed")
    expect(h.landScripts()[0]?.output).toEqual({ log: LOG })
    expect(h.said()).toContain("↳ gtd(agent): s → t")
    expect(h.said()).toContain("● your turn — gate")
    expect(h.said()).not.toContain("read me")
    expect(h.log()).toContain("read me")
    expect(h.landCalls()).toHaveLength(1)
  })

  it("starts the log fresh and writes a header per beat", async () => {
    const h = fakeHost({ beats: [prompt(), gate()] })
    await h.run()
    expect(h.log().startsWith(`<reset ${LOG}>`)).toBe(true)
    expect(h.log()).toMatch(/─── beat #1 {2}\d\d:\d\d:\d\d {2}prompt: working ───/)
    expect(h.log()).toMatch(/─── beat #2 {2}\d\d:\d\d:\d\d {2}message: gate ───/)
  })

  it("resolves a relative log path against the repository root, not the caller's directory", async () => {
    const h = fakeHost({
      beats: [beat({ kind: "script", content: "true", log: ".git/gtd-loop.log" }), gate()],
    })
    await h.run()
    expect(h.log().startsWith("<reset /repo/.git/gtd-loop.log>")).toBe(true)
    expect(h.landScripts()[0]?.output).toEqual({ log: "/repo/.git/gtd-loop.log" })
  })

  it("names the step label at a gate", async () => {
    const h = fakeHost({
      beats: [prompt(), beat({ kind: "message", state: "gate", label: "Plan review" })],
    })
    await h.run()
    expect(h.said()).toContain("● your turn — gate (Plan review)")
  })

  it("lands the opening beat even at a clean gate, then stops at idle", async () => {
    const h = fakeHost({
      beats: [gate("await"), beat({ kind: "message", state: "idle", idle: true })],
    })
    const exit = await h.run()
    expect(EffectExit.isSuccess(exit)).toBe(true)
    expect(h.landCalls()).toHaveLength(1)
    expect(h.said()).toContain("● done — idle")
    expect(h.log()).toContain("PLAIN NEXT")
  })

  it("lands the opening beat even when it is already idle", async () => {
    const h = fakeHost({
      beats: [
        beat({ kind: "message", state: "idle", idle: true }),
        beat({ kind: "message", state: "idle", idle: true }),
      ],
    })
    await h.run()
    expect(h.landCalls()).toHaveLength(1)
  })

  it("lands a capture beat outright, without an agent turn", async () => {
    const h = fakeHost({ beats: [beat({ kind: "capture" }), gate()] })
    await h.run()
    expect(h.agentCalls()).toHaveLength(0)
    expect(h.landCalls()).toHaveLength(1)
  })

  it("runs a script beat into the log and lands it whatever its exit code", async () => {
    const h = fakeHost({
      beats: [beat({ kind: "script", content: "npm test" }), gate()],
      script: () => ({ code: 7, stdout: "", stderr: "" }),
    })
    const exit = await h.run()
    expect(EffectExit.isSuccess(exit)).toBe(true)
    const run = h.requests.find((r) => r.command === "sh" && r.args[0] === "-c")
    expect(run?.args).toEqual(["-c", "npm test"])
    expect(run?.output).toEqual({ log: LOG })
    expect(h.landCalls()).toHaveLength(1)
  })

  it("fails on a stall, with gtd's diagnosis, and lands nothing", async () => {
    const h = fakeHost({
      beats: [beat({ kind: "stalled", content: 'stalled at "working": try again\n' })],
    })
    const exit = await h.run()
    expect(failure(exit)).toBe('stalled at "working": try again')
    expect(h.log()).toContain('stalled at "working"')
    expect(h.landCalls()).toHaveLength(0)
  })

  it("fails on a beat kind it does not know", async () => {
    const h = fakeHost({ beats: [beat({ kind: "teleport" })] })
    expect(failure(await h.run())).toBe('unknown beat kind "teleport"')
  })

  it("refuses a beat document with an unsupported schema, before acting on it", async () => {
    const h = fakeHost({ beats: [JSON.stringify({ ...JSON.parse(prompt()), schema: 2 })] })
    const message = failure(await h.run())
    expect(message).toContain("schema 2")
    expect(message).toContain(`schema ${WIRE_SCHEMA} only`)
    expect(h.agentCalls()).toHaveLength(0)
    expect(h.landCalls()).toHaveLength(0)
  })

  it("refuses a landing document with an unsupported schema, before running its script", async () => {
    const h = fakeHost({ beats: [beat({ kind: "capture" })], lands: [landing({ schema: 99 })] })
    expect(failure(await h.run())).toContain("schema 99")
    expect(h.landScripts()).toHaveLength(0)
  })

  it("fails when gtd itself fails, carrying gtd's stderr", async () => {
    const h = fakeHost({ beats: [] })
    const message = failure(await h.run())
    expect(message).toContain("`gtd next --json` failed (exit 1)")
    expect(message).toContain("no more beats")
  })

  it("fails when the landing script fails", async () => {
    const h = fakeHost({
      beats: [beat({ kind: "capture" })],
      landScript: { code: 1, stdout: "", stderr: "" },
    })
    expect(failure(await h.run())).toBe(`the landing script failed (exit 1) — see ${LOG}`)
  })

  it("stops when a landing settles, showing the idle message", async () => {
    const h = fakeHost({
      beats: [beat({ kind: "script", content: "true" })],
      lands: [landing({ settled: true, idle: true, subject: null })],
    })
    const exit = await h.run()
    expect(EffectExit.isSuccess(exit)).toBe(true)
    expect(h.said()).toContain("✔ settled — nothing owed")
    expect(h.said()).toContain("PLAIN NEXT")
    expect(h.said()).not.toContain("↳")
  })
})

describe("runLoop — agent turns", () => {
  const flags = (h: ReturnType<typeof fakeHost>) =>
    h.agentCalls().map((r) => r.args.slice(1, 3).join(" "))

  it("tries the resume hint's flag first and falls back to the other", async () => {
    const h = fakeHost({
      beats: [prompt({ session: { id: "sid", resume: true } }), gate()],
      agent: (r) =>
        r.args[1] === "--resume" ? { code: 1, stdout: "", stderr: "gone" } : ok(envelope({})),
    })
    expect(EffectExit.isSuccess(await h.run())).toBe(true)
    expect(flags(h)).toEqual(["--resume sid", "--session-id sid"])
    expect(h.said()).toContain("✘ agent turn failed (exit 1)")
    expect(h.said()).toContain("gone")
  })

  it("fails when both session flags fail, landing nothing", async () => {
    const h = fakeHost({
      beats: [prompt()],
      agent: () => ({ code: 2, stdout: "", stderr: "" }),
    })
    expect(failure(await h.run())).toBe("agent turn failed on both session flags")
    expect(flags(h)).toEqual(["--session-id sid", "--resume sid"])
    expect(h.landCalls()).toHaveLength(0)
  })

  it("treats an is_error envelope as a failed turn even at exit 0", async () => {
    const h = fakeHost({
      beats: [prompt()],
      agent: () => ok(envelope({ is_error: true, result: "max turns" })),
    })
    expect(failure(await h.run())).toBe("agent turn failed on both session flags")
    expect(h.said()).toContain("max turns")
  })

  it("logs the envelope's result text and the agent's stderr, not raw JSON", async () => {
    const h = fakeHost({
      beats: [prompt(), gate()],
      agent: () => ({ code: 0, stdout: envelope({ result: "all built" }), stderr: "warn\n" }),
    })
    await h.run()
    expect(h.log()).toContain("warn\nall built\n")
    expect(h.log()).not.toContain("total_cost_usd")
  })

  it("logs raw output when the agent died before writing an envelope", async () => {
    const h = fakeHost({
      beats: [prompt()],
      agent: () => ({ code: 1, stdout: "segfault", stderr: "" }),
    })
    await h.run()
    expect(h.log()).toContain("segfault")
  })

  it("passes the system prompt, and drops --model when the beat names none", async () => {
    const h = fakeHost({ beats: [prompt({ model: undefined, system: "persona" }), gate()] })
    await h.run()
    expect(h.agentCalls()[0]?.args).toEqual([
      "-p",
      "--session-id",
      "sid",
      "--system-prompt",
      "persona",
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
    ])
  })

  it("records every paid turn's cost, failed ones included, with the resolved model", async () => {
    const h = fakeHost({
      beats: [prompt(), gate()],
      agent: (r) =>
        r.args[1] === "--session-id"
          ? { code: 1, stdout: envelope({ total_cost_usd: 0.25 }), stderr: "" }
          : ok(envelope({ total_cost_usd: 0.125 })),
    })
    await h.run()
    expect(h.landCalls()[0]).toEqual([
      "/gtd.mjs",
      "land",
      "--json",
      "--cost=0.375000",
      "--model=opus",
    ])
  })

  it("records no cost when the agent reported none", async () => {
    const h = fakeHost({
      beats: [prompt(), gate()],
      agent: () => ok(envelope({ total_cost_usd: undefined })),
    })
    await h.run()
    expect(h.landCalls()[0]).toEqual(["/gtd.mjs", "land", "--json"])
  })

  it("drives pi when configured, reading its event stream", async () => {
    const events = [
      { type: "message_end", message: { role: "user", content: [] } },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "pi did it" }],
          usage: { cost: { total: 0.5 } },
        },
      },
    ]
    const h = fakeHost({
      beats: [prompt({ model: "gpt-5" }), gate()],
      env: { GTD_LOOP_AGENT: "pi" },
      agent: () => ok(events.map((e) => JSON.stringify(e)).join("\n")),
    })
    await h.run()
    expect(h.agentCalls()[0]?.command).toBe("pi")
    expect(h.agentCalls()[0]?.args).toEqual([
      "-p",
      "--session-id",
      "sid",
      "--model",
      "gpt-5",
      "--mode",
      "json",
      "--no-approve",
    ])
    expect(h.log()).toContain("pi did it")
    expect(h.landCalls()[0]).toContain("--cost=0.500000")
  })

  it("fails a pi turn that streamed an error event", async () => {
    const h = fakeHost({
      beats: [prompt()],
      env: { GTD_LOOP_AGENT: "pi" },
      agent: () => ok(JSON.stringify({ type: "error", message: "boom" })),
    })
    expect(failure(await h.run())).toBe("agent turn failed on both session flags")
  })
})

describe("runLoop — judge gates", () => {
  const judgment = JSON.stringify({ schema: WIRE_SCHEMA, state: {}, questions: [] })
  const judgeGate = (state = "judging"): string =>
    beat({ kind: "message", state, content: "a judgment is pending", judge: judgment })
  const VERDICT = '[{"id":"q","answer":true,"p":0.9}]\n'

  it("pipes the beat's judge document to gtd judge run and lands its verdict through gtd judge answer", async () => {
    const host = fakeHost({
      beats: [prompt(), judgeGate(), gate()],
      judge: () => ok(VERDICT),
    })
    expect(EffectExit.isSuccess(await host.run())).toBe(true)
    expect(host.judgeCalls().map((r) => r.stdin)).toEqual([judgment])
    expect(host.answerCalls().map((r) => [r.args.slice(1), r.stdin])).toEqual([
      [["judge", "answer", "--json"], VERDICT],
    ])
    expect(host.landScripts()).toHaveLength(2)
    expect(host.said()).toContain("your turn — gate")
  })

  it("hands a judge gate to the human when gtd judge run fails, logging why", async () => {
    const host = fakeHost({ beats: [prompt(), judgeGate()] })
    expect(EffectExit.isSuccess(await host.run())).toBe(true)
    expect(host.answerCalls()).toEqual([])
    expect(host.said()).toContain("your turn — judging")
    expect(host.log()).toContain("no judge configured")
  })

  it("hands a judge gate to the human when gtd judge answer rejects the verdict, landing nothing", async () => {
    const host = fakeHost({
      beats: [prompt(), judgeGate()],
      judge: () => ok(VERDICT),
      answer: () => ({ code: 2, stdout: "", stderr: "the verdict does not match" }),
    })
    expect(EffectExit.isSuccess(await host.run())).toBe(true)
    expect(host.landScripts()).toHaveLength(1)
    expect(host.said()).toContain("your turn — judging")
    expect(host.log()).toContain("the verdict does not match")
  })

  it("does not judge the same state twice in a row", async () => {
    const host = fakeHost({
      beats: [prompt(), judgeGate(), judgeGate()],
      judge: () => ok(VERDICT),
    })
    expect(EffectExit.isSuccess(await host.run())).toBe(true)
    expect(host.judgeCalls()).toHaveLength(1)
    expect(host.said()).toContain("your turn — judging")
  })

  it("stops at an opening judge gate the judge could not answer, landing nothing", async () => {
    const host = fakeHost({ beats: [judgeGate()] })
    expect(EffectExit.isSuccess(await host.run())).toBe(true)
    expect(host.landCalls()).toEqual([])
    expect(host.answerCalls()).toEqual([])
    expect(host.landScripts()).toEqual([])
    expect(host.said()).toContain("your turn — judging")
  })

  it("judges the opening beat too", async () => {
    const host = fakeHost({ beats: [judgeGate(), gate()], judge: () => ok(VERDICT) })
    expect(EffectExit.isSuccess(await host.run())).toBe(true)
    expect(host.answerCalls()).toHaveLength(1)
    expect(host.landCalls()).toEqual([])
  })
})

describe("runLoop — the self-validation gate", () => {
  const failing = (output: string): Result => ({ code: 1, stdout: output, stderr: "" })

  it("re-prompts the validation output verbatim on the resumed session until it passes", async () => {
    const h = fakeHost({
      beats: [prompt({ validate: "gtd validate-it" }), gate()],
      validate: (n) => (n < 2 ? failing(`fix #${n}`) : ok()),
    })
    expect(EffectExit.isSuccess(await h.run())).toBe(true)
    const turns = h.agentCalls()
    expect(turns.map((t) => t.stdin)).toEqual(["PLAIN NEXT\n", "fix #0", "fix #1"])
    expect(turns.slice(1).map((t) => t.args[1])).toEqual(["--resume", "--resume"])
    expect(turns.slice(1).every((t) => t.args.includes("opus"))).toBe(true)
    expect(h.landCalls()).toHaveLength(1)
  })

  it("gives up after three fix turns", async () => {
    const h = fakeHost({
      beats: [prompt({ validate: "check" })],
      validate: () => failing("still broken"),
    })
    expect(failure(await h.run())).toBe("validation still failing after 3 fixes")
    expect(h.agentCalls()).toHaveLength(4)
    expect(h.said()).toContain("still broken")
    expect(h.landCalls()).toHaveLength(0)
  })

  it("fails when a fix turn fails", async () => {
    const h = fakeHost({
      beats: [prompt({ validate: "check" })],
      validate: () => failing("broken"),
      agent: (r) => (r.stdin === "broken" ? { code: 1, stdout: "", stderr: "" } : ok(envelope({}))),
    })
    expect(failure(await h.run())).toBe("agent turn failed while fixing validation")
  })
})

describe("runLoop — per-machine settings", () => {
  it("fails on an invalid config file instead of guessing", async () => {
    const h = fakeHost({
      beats: [prompt()],
      files: { "/home/me/.config/gtd/loop.json": "{ nope" },
    })
    expect(failure(await h.run())).toContain("/home/me/.config/gtd/loop.json: not JSON")
  })
})
