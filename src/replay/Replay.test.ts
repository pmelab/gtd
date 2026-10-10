import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  FLOWS_PROTOCOL,
  agent,
  changes,
  changesSince,
  codeThreads,
  human,
  judge,
  read,
  refuse,
  restart,
  run,
  scope,
  threads,
  type Flow,
  type ScopeAccess,
} from "../flows/index.js"
import type { Episode, ReplayOutcome } from "./Replay.js"
import {
  formatCommitMessage,
  replay,
  treeFromRecord,
  type JudgeVerdict,
  type TreeView,
} from "./index.js"

// A tiny in-memory history: each `land` commits a tree and a message, the way
// a landing would, so tests read like the process they model.
interface Commit {
  readonly hash: string
  readonly message: string
  readonly tree: TreeView
}

const hashOf = (n: number): string => n.toString(16).padStart(40, "0")

class History {
  readonly commits: Commit[] = []
  files: Record<string, string> = {}
  private counter = 1

  land(
    actor: string,
    from: string,
    occurrence: number,
    to: string,
    edit: Record<string, string | null> = {},
    judgeVerdicts?: readonly JudgeVerdict[],
  ): this {
    this.apply(edit)
    this.commits.push({
      hash: hashOf(this.counter++),
      message: formatCommitMessage({
        actor,
        from,
        to,
        step: { name: from, occurrence },
        ...(judgeVerdicts !== undefined ? { judge: judgeVerdicts } : {}),
      }),
      tree: treeFromRecord({ ...this.files }),
    })
    return this
  }

  raw(message: string, edit: Record<string, string | null> = {}): this {
    this.apply(edit)
    this.commits.push({
      hash: hashOf(this.counter++),
      message,
      tree: treeFromRecord({ ...this.files }),
    })
    return this
  }

  private apply(edit: Record<string, string | null>): void {
    const next = { ...this.files }
    for (const [path, content] of Object.entries(edit)) {
      if (content === null) delete next[path]
      else next[path] = content
    }
    this.files = next
  }

  episode(): Episode {
    return {
      base: { hash: hashOf(0), tree: treeFromRecord({ "README.md": "# x\n" }) },
      commits: this.commits,
    }
  }
}

const replayOf = (
  wf: Flow,
  h: History,
  extra: { pending?: Record<string, string>; verdicts?: JudgeVerdict[] } = {},
): Promise<ReplayOutcome> =>
  replay({
    flow: wf,
    episode: h.episode(),
    vars: { cap: "2" },
    env: {},
    start: hashOf(0),
    budgetBytes: 1024,
    ...(extra.pending !== undefined
      ? {
          pending: {
            tree: treeFromRecord({ ...h.files, ...extra.pending }),
            ...(extra.verdicts !== undefined ? { verdicts: extra.verdicts } : {}),
          },
        }
      : {}),
  })

const PROTOCOL_KEY = Symbol.for("@pmelab/gtd/flow-protocol")

describe("the flows protocol handshake", () => {
  it("installs the protocol it implements under the registered key", async () => {
    let seen: unknown
    await replayOf(async () => {
      seen = (globalThis as Record<symbol, unknown>)[PROTOCOL_KEY]
      await human("idle")
    }, new History())
    expect(seen).toBe(FLOWS_PROTOCOL)
  })

  it("refuses a mismatch the workflow caught and swallowed", async () => {
    const outcome = await replayOf(async () => {
      ;(globalThis as Record<symbol, unknown>)[PROTOCOL_KEY] = FLOWS_PROTOCOL + 1
      await human("idle").catch(() => undefined)
    }, new History())
    expect(outcome).toEqual({
      kind: "failed",
      message: `gtd: the workflow speaks flows protocol ${FLOWS_PROTOCOL}, but the engine installed protocol ${FLOWS_PROTOCOL + 1} — upgrade the @pmelab/gtd the workflow imports`,
    })
  })

  it("frames an ordinary workflow error as the workflow throwing", async () => {
    const outcome = await replayOf(async () => {
      throw new Error("boom")
    }, new History())
    expect(outcome).toEqual({ kind: "failed", message: "gtd: the workflow threw: boom" })
  })

  it("unwraps a mismatch thrown by a second copy of the flows facade", async () => {
    // A workflow package resolving its own @pmelab/gtd throws that copy's
    // class, which `instanceof` against the engine's copy never matches.
    class FlowsProtocolError extends Error {
      override name = "FlowsProtocolError"
    }
    const outcome = await replayOf(async () => {
      throw new FlowsProtocolError("gtd: the workflow speaks flows protocol 0")
    }, new History())
    expect(outcome).toEqual({
      kind: "failed",
      message: "gtd: the workflow speaks flows protocol 0",
    })
  })
})

const restName = (outcome: ReplayOutcome): string => {
  if (outcome.kind !== "rest") throw new Error(`expected a rest, got ${JSON.stringify(outcome)}`)
  return `${outcome.rest.name}#${outcome.rest.id.occurrence}`
}

// Plain loops, a counter cap, and helper-driven branches: the shape the
// bundled workflow has.
const fixLoop = async () => {
  await human("idle", { file: "TODO.md" })
  for (let attempt = 1; ; attempt++) {
    await run("check", "npm test")
    if (read(".gtd/FEEDBACK.md") === undefined) break
    if (attempt > 2) {
      await human("stuck")
      continue
    }
    await agent("fix", "fix it")
  }
  await human("done")
}

describe("replay", () => {
  it("rests at the first step of an empty episode", async () => {
    expect(restName(await replayOf(fixLoop, new History()))).toBe("idle#1")
  })

  it("answers each step from its commit and rests at the first step without one", async () => {
    const h = new History()
      .land("human", "idle", 1, "check", { "TODO.md": "go" })
      .land("check", "check", 1, "fix", { ".gtd/FEEDBACK.md": "red" })
    expect(restName(await replayOf(fixLoop, h))).toBe("fix#1")
  })

  it("branches on the tree the step committed", async () => {
    const h = new History()
      .land("human", "idle", 1, "check", { "TODO.md": "go" })
      .land("check", "check", 1, "done", {})
    expect(restName(await replayOf(fixLoop, h))).toBe("done#1")
  })

  it("counts loop rounds with an ordinary counter", async () => {
    const h = new History().land("human", "idle", 1, "check", { "TODO.md": "go" })
    for (let round = 1; round <= 2; round++) {
      h.land("check", "check", round, "fix", { ".gtd/FEEDBACK.md": `red ${round}` })
      h.land("agent", "fix", round, "check", { "src/a.ts": `${round}` })
    }
    h.land("check", "check", 3, "stuck", { ".gtd/FEEDBACK.md": "red 3" })
    expect(restName(await replayOf(fixLoop, h))).toBe("stuck#1")
  })

  it("is deterministic: the same history always yields the same rest", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { maxLength: 6 }), async (reds) => {
        const h = new History().land("human", "idle", 1, "check", { "TODO.md": "go" })
        let checks = 0
        let fixes = 0
        for (const red of reds) {
          checks++
          if (!red) {
            h.land("check", "check", checks, "done", { ".gtd/FEEDBACK.md": null })
            break
          }
          const to = checks > 2 ? "stuck" : "fix"
          h.land("check", "check", checks, to, { ".gtd/FEEDBACK.md": `red ${checks}` })
          if (to === "stuck") {
            h.land("human", "stuck", checks - 2, "check")
          } else {
            fixes++
            h.land("agent", "fix", fixes, "check", { "src/a.ts": `${fixes}` })
          }
        }
        const first = await replayOf(fixLoop, h)
        const second = await replayOf(fixLoop, h)
        expect(first.kind).not.toBe("divergence")
        expect(JSON.stringify(second)).toBe(JSON.stringify(first))
      }),
      { numRuns: 40 },
    )
  })

  it("threads() gives a flow each thread's name, 1-based line and waitingOn", async () => {
    const doc = "a.[^q]\n\n[^q]:\n    - H: why?\n    - A: because\n"
    const flow = async () => {
      await human("idle")
      const open = threads(read("NOTES.md") ?? "").filter((t) => t.waitingOn === "human")
      await human(
        open.length === 1 && open[0]!.name === "q" && open[0]!.line === 3 ? "open" : "none",
      )
    }
    const h = new History().land("human", "idle", 1, "open", { "NOTES.md": doc })
    expect(restName(await replayOf(flow, h))).toBe("open#1")
  })

  it("threads() carries each thread's own syntax faults, prefixed with its name", async () => {
    const doc = "a.[^q] b.[^r]\n\n[^q]:\n    - H: why?\n    - H: again\n\n[^r]:\n    - H: ok\n"
    const flow = async () => {
      await human("idle")
      const [q, r] = threads(read("NOTES.md") ?? "")
      const ok =
        q!.faults.length === 1 &&
        q!.faults[0]!.startsWith('Footnote thread "[^q]": two consecutive') &&
        r!.faults.length === 0
      await human(ok ? "open" : "none")
    }
    const h = new History().land("human", "idle", 1, "open", { "NOTES.md": doc })
    expect(restName(await replayOf(flow, h))).toBe("open#1")
  })

  it("codeThreads() returns threads of files changed since the process base only", async () => {
    const thread = ["// H: why?", "// A: because"].join("\n")
    const open = ["x", "// H: ask"].join("\n")
    const flow = async () => {
      await human("idle")
      const found = codeThreads()
      const ok =
        found.length === 1 &&
        found[0]!.path === "src/new.ts" &&
        found[0]!.line === 2 &&
        found[0]!.first === "ask" &&
        found[0]!.waitingOn === "agent"
      await human(ok ? "open" : "none")
    }
    const h = new History().land("human", "idle", 1, "open", { "src/new.ts": open })
    h.files = { ...h.files, "src/old.ts": thread }
    const episode = h.episode()
    const withBase: Episode = {
      ...episode,
      base: {
        ...episode.base,
        tree: treeFromRecord({ "src/old.ts": thread, "src/gone.ts": open }),
      },
      commits: [
        {
          ...episode.commits[0]!,
          tree: treeFromRecord({ "src/old.ts": thread, "src/new.ts": open }),
        },
      ],
    }
    const outcome = await replay({
      flow,
      episode: withBase,
      vars: {},
      env: {},
      start: hashOf(0),
      budgetBytes: 1024,
    })
    expect(restName(outcome)).toBe("open#1")
  })

  it("codeThreads() reaches back to a diff base older than the episode base", async () => {
    // An entered process: its review base predates the opening commit, which
    // is the episode base — so the opening commit's own edits still count.
    const open = ["x", "// H: ask"].join("\n")
    const flow = async () => {
      await human("idle")
      await human(codeThreads().length === 1 ? "open" : "none")
    }
    const h = new History()
    h.files = { "src/a.ts": open }
    h.land("human", "idle", 1, "open", { "TODO.md": "go" })
    const episode = h.episode()
    const outcome = await replay({
      flow,
      episode: {
        ...episode,
        base: { hash: hashOf(99), tree: treeFromRecord({ "src/a.ts": open }) },
      },
      vars: {},
      env: {},
      start: hashOf(98),
      startTree: treeFromRecord({}),
      budgetBytes: 1024,
    })
    expect(restName(outcome)).toBe("open#1")
  })

  describe("divergence", () => {
    it("is reported when a commit records a different step than replay reaches", async () => {
      const h = new History().land("human", "idle", 1, "check", { "TODO.md": "go" })
      h.land("check", "fix", 1, "check", { ".gtd/FEEDBACK.md": "red" })
      const outcome = await replayOf(fixLoop, h)
      expect(outcome.kind).toBe("divergence")
      expect(outcome.kind === "divergence" && outcome.message).toContain('expected "check#1"')
    })

    it("is reported when a step commit carries no Gtd-Step trailer", async () => {
      const h = new History().raw("gtd(human): idle → check", { "TODO.md": "go" })
      const outcome = await replayOf(fixLoop, h)
      expect(outcome.kind).toBe("divergence")
      expect(outcome.kind === "divergence" && outcome.message).toContain("records no step")
    })

    it("is reported when the subject names a different next step than replay reaches", async () => {
      const h = new History().land("human", "idle", 1, "fix", { "TODO.md": "go" })
      const outcome = await replayOf(fixLoop, h)
      expect(outcome.kind).toBe("divergence")
      expect(outcome.kind === "divergence" && outcome.message).toContain('reached "check"')
    })

    it("is reported when history continues past the end of the flow", async () => {
      const short = async () => void (await human("only"))
      const h = new History().land("human", "only", 1, "only").land("human", "only", 2, "only")
      expect((await replayOf(short, h)).kind).toBe("divergence")
    })
  })

  it("skips an attempt — an empty, trailer-less self-loop at the resting step", async () => {
    const h = new History()
      .land("human", "idle", 1, "check", { "TODO.md": "go" })
      .land("check", "check", 1, "fix", { ".gtd/FEEDBACK.md": "red" })
      .raw("gtd(agent): fix")
    expect(restName(await replayOf(fixLoop, h))).toBe("fix#1")
  })

  it("lands a pending turn on the resting step and rests at the next one", async () => {
    const h = new History().land("human", "idle", 1, "check", { "TODO.md": "go" })
    const outcome = await replayOf(fixLoop, h, { pending: { ".gtd/FEEDBACK.md": "red" } })
    expect(outcome.kind === "rest" && outcome.landed?.name).toBe("check")
    expect(restName(outcome)).toBe("fix#1")
  })

  it("reads helpers against the replay position, not the working tree", async () => {
    const wf = async () => {
      await human("write")
      if (changes(".gtd/*.md").some((c) => c.status === "added"))
        await agent("saw", read(".gtd/NOTE.md") ?? "")
      else await agent("missed", "nothing")
    }
    const h = new History().land("human", "write", 1, "saw", { ".gtd/NOTE.md": "hello" })
    const outcome = await replayOf(wf, h)
    expect(restName(outcome)).toBe("saw#1")
    expect(
      outcome.kind === "rest" &&
        outcome.rest.request.kind === "agent" &&
        outcome.rest.request.prompt,
    ).toBe("hello")
  })

  it("reports what the last step changed, with content on both sides", async () => {
    let seen: unknown
    const wf = async () => {
      for (;;) {
        await human("write")
        seen = changes().map(({ path, status, before, after }) => ({ path, status, before, after }))
      }
    }
    const h = new History()
      .land("human", "write", 1, "write", { keep: "old", gone: "bye" })
      .land("human", "write", 2, "write", { keep: "new", gone: null, fresh: "hi" })
    await replayOf(wf, h)
    expect(seen).toEqual([
      { path: "fresh", status: "added", before: undefined, after: "hi" },
      { path: "gone", status: "deleted", before: "bye", after: undefined },
      { path: "keep", status: "modified", before: "old", after: "new" },
    ])
  })

  it("changesSince(hash) diffs the tree at hash to the tree replay stands on", async () => {
    let seen: unknown
    const wf = async () => {
      const since = hashOf(1)
      for (;;) {
        await human("write")
        seen = changesSince(since).map(({ path, status }) => ({ path, status }))
      }
    }
    const h = new History()
      .land("human", "write", 1, "write", { a: "1" })
      .land("human", "write", 2, "write", { b: "1" })
      .land("human", "write", 3, "write", { c: "1" })
    await replayOf(wf, h)
    expect(seen).toEqual([
      { path: "b", status: "added" },
      { path: "c", status: "added" },
    ])
  })

  it("changesSince(hash) resolves against the episode base, and is empty over a zero-length range", async () => {
    let seenFromBase: unknown
    let seenFromLast: unknown
    const wf = async () => {
      for (;;) {
        await human("write")
        seenFromBase = changesSince(hashOf(0)).paths
        seenFromLast = changesSince(hashOf(2)).paths
      }
    }
    const h = new History()
      .land("human", "write", 1, "write", { a: "1" })
      .land("human", "write", 2, "write", { b: "1" })
    await replayOf(wf, h)
    expect(seenFromBase).toEqual(["a", "b", "README.md"])
    expect(seenFromLast).toEqual([])
  })

  // A squash or rebase never strands a captured hash: `since` is never
  // persisted, and every replay re-derives its own commit list from whatever
  // history exists at that moment (see the comment at `treeAt`). What DOES
  // reach the guard is a hash from outside that run entirely — read out of
  // state, from another branch, or otherwise fabricated. This case models
  // that: a hash real in one episode, handed to a second, unrelated episode
  // that never held it.
  it("fails the step when changesSince is given a hash that resolved in an earlier episode but not this one", async () => {
    const hash = hashOf(2)
    const wf = async () => {
      for (;;) {
        await human("write")
        changesSince(hash)
      }
    }
    // First: prove `hash` really does resolve — a two-commit episode where it
    // names the second commit.
    const resolvable = new History()
      .land("human", "write", 1, "write", { a: "1" })
      .land("human", "write", 2, "write", { b: "1" })
    const resolved = await replayOf(wf, resolvable)
    expect(resolved.kind).not.toBe("failed")

    // Then: a squash collapses those two commits into one, so the same hash
    // no longer names anything in this episode's commit list.
    const squashed = new History().land("human", "write", 1, "write", { a: "1", b: "1" })
    const outcome = await replayOf(wf, squashed)
    expect(outcome.kind).toBe("failed")
    expect(outcome.kind === "failed" && outcome.message).toContain(
      `changesSince(${hash}): ${hash} is not the episode base or one of its commits`,
    )
    expect(outcome.kind === "failed" && outcome.message).toContain("pass a hash this run read from")
  })

  it("keeps a local variable across replayed steps", async () => {
    let seen: string | undefined = "unset"
    const wf = async () => {
      let previous: string | undefined
      for (;;) {
        await run("check", "true")
        seen = previous
        previous = read("OUT")
        await human("look")
      }
    }
    const h = new History()
      .land("check", "check", 1, "look", { OUT: "first" })
      .land("human", "look", 1, "check")
      .land("check", "check", 2, "look", { OUT: "second" })
    await replayOf(wf, h)
    expect(seen).toBe("first")
  })

  it("answers a judge step from its Gtd-Judge trailer", async () => {
    const question = { id: "verdict", primitive: "choice", instructions: "", criteria: "" } as const
    const wf = async () => {
      const { answers } = await judge("same", { questions: [question], evidence: {} })
      const verdict = answers.verdict
      if (verdict?.answer === "identical" && verdict.p >= 0.7) await human("escalate")
      else await human("retry")
    }
    const confident = new History().land("judge", "same", 1, "escalate", {}, [
      { id: "verdict", answer: "identical", p: 0.9 },
    ])
    expect(restName(await replayOf(wf, confident))).toBe("escalate#1")
    const unsure = new History().land("judge", "same", 1, "retry", {}, [
      { id: "verdict", answer: "identical", p: 0.5 },
    ])
    expect(restName(await replayOf(wf, unsure))).toBe("retry#1")
    const skipped = new History().land("judge", "same", 1, "retry")
    expect(restName(await replayOf(wf, skipped))).toBe("retry#1")
  })

  it("prefixes names inside scope() and derives the memory scope from the name", async () => {
    const wf = () => scope("build", () => scope("health", () => agent("fix", "x")))
    const outcome = await replayOf(wf, new History())
    expect(restName(outcome)).toBe("build.health.fix#1")
    expect(outcome.kind === "rest" && outcome.rest.memoryScope).toBe("build.health")
  })

  it("gives a scope's model to the agent steps inside, and refuses two identities in one scope", async () => {
    const wf = () =>
      scope({ model: "smart" }, async () => {
        await agent("one", "a")
        await scope({ name: "plan", model: "base" }, () => agent("two", "b"))
        await agent("three", "c", { model: "base" })
      })
    const modelAt = (outcome: ReplayOutcome) =>
      outcome.kind === "rest" &&
      outcome.rest.request.kind === "agent" &&
      outcome.rest.request.options.model
    expect(modelAt(await replayOf(wf, new History()))).toBe("smart")
    const h = new History().land("agent", "one", 1, "plan.two", { a: "1" })
    expect(modelAt(await replayOf(wf, h))).toBe("base")
    h.land("agent", "plan.two", 1, "three", { b: "1" })
    expect((await replayOf(wf, h)).kind).toBe("failed")
  })

  it("ends the episode on return and on restart", async () => {
    const returning = async () => void (await human("only"))
    const h = new History().land("human", "only", 1, "only")
    expect(await replayOf(returning, h)).toMatchObject({ kind: "ended", via: "return" })

    const restarting = async () => {
      await human("first")
      await restart()
      await human("never")
    }
    const r = new History().land("human", "first", 1, "first")
    expect(await replayOf(restarting, r)).toMatchObject({ kind: "ended", via: "restart" })
  })

  it("reports refuse() as a refusal and a throw as a failure", async () => {
    const refusing = async () => {
      await human("gate")
      if (read("bad") !== undefined) refuse("no bad files")
      await human("next")
    }
    const outcome = await replayOf(refusing, new History(), { pending: { bad: "x" } })
    expect(outcome).toEqual({ kind: "refused", message: "no bad files" })

    const throwing = async () => {
      throw new Error("boom")
    }
    expect(await replayOf(throwing, new History())).toMatchObject({ kind: "failed" })
  })

  it("fails a run step whose body is not a shell script", async () => {
    const wf = async () => {
      await run("check", (() => undefined) as unknown as string)
    }
    const outcome = await replayOf(wf, new History())
    expect(outcome).toMatchObject({ kind: "failed" })
    expect(outcome.kind === "failed" && outcome.message).toContain("shell script string")
  })

  it("fails a flow that awaits something other than a step", async () => {
    const waiting = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      await human("late")
    }
    const outcome = await replayOf(waiting, new History())
    expect(outcome.kind === "failed" && outcome.message).toContain("not a step")
  })
})

describe("replay: skills resolution", () => {
  interface Tiers {
    skills?: Record<string, readonly string[]>
    configuredSkills?: Record<string, readonly string[]>
  }

  const restOf = async (flow: Flow, tiers: Tiers = {}) => {
    const outcome = await replay({
      flow,
      episode: new History().episode(),
      vars: {},
      env: {},
      start: hashOf(0),
      budgetBytes: 1024,
      ...tiers,
    })
    return outcome
  }

  const wireSkills = async (flow: Flow, tiers: Tiers = {}) => {
    const outcome = await restOf(flow, tiers)
    if (outcome.kind !== "rest") throw new Error(`expected a rest, got ${JSON.stringify(outcome)}`)
    return outcome.rest.skills
  }

  type Body = () => Promise<void>
  const inScope =
    (options: { name: string; skills?: readonly string[] }, ...rest: Body[]): Flow =>
    async () => {
      await scope(options, async () => {
        for (const f of rest) await f()
      })
    }
  const step: Body = async () => {
    await agent("step", "prompt")
  }

  it("rejects a skills option on agent()", async () => {
    const outcome = await restOf(async () => {
      await agent("step", "prompt", { skills: ["own"] } as never)
    })
    expect(outcome).toMatchObject({
      kind: "failed",
      message: 'gtd: step "step": unknown key(s) skills in agent() options',
    })
  })

  it("reads the list a scope() option declares", async () => {
    expect(await wireSkills(inScope({ name: "a", skills: ["own"] }, step))).toEqual(["own"])
  })

  it("inherits a parent scope's list in a nested scope", async () => {
    const flow = inScope({ name: "a", skills: ["parent"] }, async () => {
      await scope("b", step)
    })
    expect(await wireSkills(flow)).toEqual(["parent"])
  })

  it("replaces the parent's list wholesale when a nested scope sets its own", async () => {
    const flow = inScope({ name: "a", skills: ["parent"] }, async () => {
      await scope({ name: "b", skills: ["child"] }, step)
    })
    expect(await wireSkills(flow)).toEqual(["child"])
  })

  it("falls back to the bundled export keyed by scope, walking up prefixes", async () => {
    const flow = inScope({ name: "a" }, async () => {
      await scope("b", step)
    })
    expect(await wireSkills(flow, { skills: { a: ["bundled"] } })).toEqual(["bundled"])
    expect(await wireSkills(flow, { skills: { a: ["x"], "a.b": ["inner"] } })).toEqual(["inner"])
  })

  it("resolves an implicit dotted scope from its own export entry", async () => {
    const flow = inScope({ name: "a" }, async () => {
      await agent("review.reviewing", "prompt")
    })
    expect(await wireSkills(flow, { skills: { a: ["x"], "a.review": ["own"] } })).toEqual(["own"])
  })

  it("ranks .gtdrc above the scope() option above the export", async () => {
    const flow = inScope({ name: "a", skills: ["option"] }, step)
    expect(await wireSkills(flow, { skills: { a: ["bundled"] } })).toEqual(["option"])
    expect(
      await wireSkills(flow, { skills: { a: ["bundled"] }, configuredSkills: { a: ["rc"] } }),
    ).toEqual(["rc"])
  })

  it("lets a parent .gtdrc entry reach a nested scope with no list, but not one with its own", async () => {
    const bare = inScope({ name: "a" }, async () => {
      await scope("b", step)
    })
    const own = inScope({ name: "a" }, async () => {
      await scope({ name: "b", skills: ["child"] }, step)
    })
    expect(await wireSkills(bare, { configuredSkills: { a: ["rc"] } })).toEqual(["rc"])
    expect(await wireSkills(own, { configuredSkills: { a: ["rc"] } })).toEqual(["child"])
  })

  it("leaves an empty resolved list absent, never []", async () => {
    const flow = inScope({ name: "a", skills: ["option"] }, step)
    expect(await wireSkills(flow, { configuredSkills: { a: [] } })).toBeUndefined()
    expect(await wireSkills(inScope({ name: "a" }, step), { skills: { a: [] } })).toBeUndefined()
  })

  it("fails two agent steps in one memory scope with different lists", async () => {
    const flow: Flow = async () => {
      await scope({ name: "a", skills: ["one"] }, async () => {
        await agent("first", "prompt")
      })
      await scope({ name: "a", skills: ["two"] }, async () => {
        await agent("second", "prompt")
      })
    }
    const history = new History()
    history.land("agent", "a.first", 1, "a.second", { "x.txt": "x" })
    const outcome = await replay({
      flow,
      episode: history.episode(),
      vars: {},
      env: {},
      start: hashOf(0),
      budgetBytes: 1024,
    })
    expect(outcome.kind === "failed" && outcome.message).toContain(
      "different model, system prompt, skills or file access",
    )
  })
})

describe("replay: access resolution", () => {
  interface Tiers {
    access?: Record<string, ScopeAccess>
    configuredAccess?: Record<string, ScopeAccess>
  }

  const restOf = (flow: Flow, tiers: Tiers = {}, history = new History()) =>
    replay({
      flow,
      episode: history.episode(),
      vars: {},
      env: {},
      start: hashOf(0),
      budgetBytes: 1024,
      ...tiers,
    })

  const wireAccess = async (flow: Flow, tiers: Tiers = {}) => {
    const outcome = await restOf(flow, tiers)
    if (outcome.kind !== "rest") throw new Error(`expected a rest, got ${JSON.stringify(outcome)}`)
    return outcome.rest.access
  }

  const step = async () => {
    await agent("step", "prompt")
  }

  it("is unrestricted when nothing declares access", async () => {
    expect(await wireAccess(async () => step())).toEqual({ read: null, write: null })
  })

  it("rejects an access option on agent()", async () => {
    const outcome = await restOf(async () => {
      await agent("step", "prompt", { access: { write: [] } } as never)
    })
    expect(outcome).toMatchObject({
      kind: "failed",
      message: 'gtd: step "step": unknown key(s) access in agent() options',
    })
  })

  it("reads a scope() access, adding the step's steering file to each restricted side", async () => {
    const flow: Flow = async () => {
      await scope({ name: "a", access: { read: ["docs/**"] } }, async () => {
        await agent("step", "prompt", { file: ".gtd/NOTES.md" })
      })
    }
    expect(await wireAccess(flow)).toEqual({
      read: ["docs/**", ".gtd/NOTES.md"],
      write: null,
    })
  })

  it("keeps read and write independent: write grants no read", async () => {
    const flow: Flow = async () => {
      await scope({ name: "a", access: { write: ["src/**"] } }, step)
    }
    expect(await wireAccess(flow)).toEqual({ read: null, write: ["src/**"] })
    const readOnly: Flow = async () => {
      await scope({ name: "a", access: { read: ["docs/**"], write: ["src/**"] } }, step)
    }
    expect((await wireAccess(readOnly))?.read).toEqual(["docs/**"])
  })

  it("inherits a parent's access, replaces it wholesale, and reopens with {}", async () => {
    const inherit: Flow = async () => {
      await scope({ name: "a", access: { write: ["p/**"] } }, () => scope("b", step))
    }
    expect(await wireAccess(inherit)).toEqual({ read: null, write: ["p/**"] })
    const replace: Flow = async () => {
      await scope({ name: "a", access: { write: ["p/**"] } }, () =>
        scope({ name: "b", access: { read: ["c/**"] } }, step),
      )
    }
    expect(await wireAccess(replace)).toEqual({ read: ["c/**"], write: null })
    const reopen: Flow = async () => {
      await scope({ name: "a", access: { write: ["p/**"] } }, () =>
        scope({ name: "b", access: {} }, step),
      )
    }
    expect(await wireAccess(reopen)).toEqual({ read: null, write: null })
  })

  it("ranks .gtdrc above the scope() option above the export", async () => {
    const flow: Flow = async () => {
      await scope({ name: "a", access: { write: ["option"] } }, step)
    }
    expect((await wireAccess(flow, { access: { a: { write: ["bundled"] } } }))?.write).toEqual([
      "option",
    ])
    expect(
      (
        await wireAccess(flow, {
          access: { a: { write: ["bundled"] } },
          configuredAccess: { a: { write: ["rc"] } },
        })
      )?.write,
    ).toEqual(["rc"])
    const bare: Flow = async () => {
      await scope("a", () => scope("b", step))
    }
    expect((await wireAccess(bare, { configuredAccess: { a: { write: ["rc"] } } }))?.write).toEqual(
      ["rc"],
    )
  })

  it("adds a code thread waiting on the agent to the restricted sides", async () => {
    const history = new History().land("human", "idle", 1, "a.step", {
      "src/a.ts": "const a = 1\n// H: fix this\n",
    })
    const flow: Flow = async () => {
      await human("idle")
      await scope({ name: "a", access: { write: [] } }, step)
    }
    const outcome = await restOf(flow, {}, history)
    if (outcome.kind !== "rest") throw new Error("expected a rest")
    expect(outcome.rest.access).toEqual({ read: null, write: ["src/a.ts"] })
  })

  it("fails two agent steps in one memory scope with different scope access", async () => {
    const flow: Flow = async () => {
      await scope({ name: "a", access: { write: ["one"] } }, () => agent("first", "prompt"))
      await scope({ name: "a", access: { write: ["two"] } }, () => agent("second", "prompt"))
    }
    const history = new History()
    history.land("agent", "a.first", 1, "a.second", { "x.txt": "x" })
    const outcome = await restOf(flow, {}, history)
    expect(outcome.kind === "failed" && outcome.message).toContain(
      "different model, system prompt, skills or file access",
    )
  })

  it("does not conflict two steps that differ only in steering file", async () => {
    const flow: Flow = async () => {
      await scope({ name: "a", access: { write: [] } }, async () => {
        await agent("first", "prompt", { file: ".gtd/ONE.md" })
        await agent("second", "prompt", { file: ".gtd/TWO.md" })
      })
    }
    const history = new History()
    history.land("agent", "a.first", 1, "a.second", { "x.txt": "x" })
    const outcome = await restOf(flow, {}, history)
    expect(outcome.kind).toBe("rest")
    if (outcome.kind === "rest") expect(outcome.rest.access?.write).toEqual([".gtd/TWO.md"])
  })

  it("fails a malformed scope() access, naming the scope", async () => {
    const flow: Flow = async () => {
      await scope({ name: "a", access: { write: "src/**" } as never }, () => scope("b", step))
    }
    const outcome = await restOf(flow)
    expect(outcome).toMatchObject({ kind: "failed" })
    expect(outcome.kind === "failed" && outcome.message).toContain('scope "a"')
  })
})
