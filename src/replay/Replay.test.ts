import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  added,
  agent,
  exists,
  history,
  human,
  judge,
  persona,
  read,
  refuse,
  restart,
  run,
  scope,
  workflow,
  type Workflow,
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

  episode(entry = "default"): Episode {
    return {
      entry,
      base: { hash: hashOf(0), tree: treeFromRecord({ "README.md": "# x\n" }) },
      commits: this.commits,
    }
  }
}

const replayOf = (
  wf: Workflow,
  h: History,
  extra: { pending?: Record<string, string>; verdicts?: JudgeVerdict[] } = {},
): Promise<ReplayOutcome> =>
  replay({
    workflow: wf,
    episode: h.episode(),
    vars: { cap: "2" },
    refs: { start: hashOf(0), processBase: hashOf(0) },
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

const restName = (outcome: ReplayOutcome): string => {
  if (outcome.kind !== "rest") throw new Error(`expected a rest, got ${JSON.stringify(outcome)}`)
  return `${outcome.rest.name}#${outcome.rest.id.occurrence}`
}

// Plain loops, a counter cap, and helper-driven branches: the shape every
// bundled fragment has.
const fixLoop = workflow({
  default: async () => {
    await human("idle", { file: "TODO.md" })
    for (let attempt = 1; ; attempt++) {
      await run("check", "npm test")
      if (!exists(".gtd/FEEDBACK.md")) break
      if (attempt > 2) {
        await human("stuck")
        continue
      }
      await agent("fix", "fix it")
    }
    await human("done")
  },
})

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
      const short = workflow({ default: async () => void (await human("only")) })
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
    const wf = workflow({
      default: async () => {
        await human("write")
        if (added(".gtd/*.md").length > 0) await agent("saw", read(".gtd/NOTE.md") ?? "")
        else await agent("missed", "nothing")
      },
    })
    const h = new History().land("human", "write", 1, "saw", { ".gtd/NOTE.md": "hello" })
    const outcome = await replayOf(wf, h)
    expect(restName(outcome)).toBe("saw#1")
    expect(
      outcome.kind === "rest" &&
        outcome.rest.request.kind === "agent" &&
        outcome.rest.request.prompt,
    ).toBe("hello")
  })

  it("resolves history.previous to what the previous completion of a step left", async () => {
    let seen: string | undefined = "unset"
    const wf = workflow({
      default: async () => {
        for (;;) {
          await run("check", "true")
          seen = history.previous("OUT", { since: "check" })
          await human("look")
        }
      },
    })
    const h = new History()
      .land("check", "check", 1, "look", { OUT: "first" })
      .land("human", "look", 1, "check")
      .land("check", "check", 2, "look", { OUT: "second" })
    await replayOf(wf, h)
    expect(seen).toBe("first")
  })

  it("answers a judge step from its Gtd-Judge trailer, honouring minP", async () => {
    const question = { id: "verdict", primitive: "choice", instructions: "", criteria: "" } as const
    const wf = workflow({
      default: async () => {
        const verdict = await judge("same", question, {}, { minP: 0.7 })
        if (verdict === "identical") await human("escalate")
        else await human("retry")
      },
    })
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
    const wf = workflow({
      default: () => scope("build", () => scope("health", () => agent("fix", "x"))),
    })
    const outcome = await replayOf(wf, new History())
    expect(restName(outcome)).toBe("build.health.fix#1")
    expect(outcome.kind === "rest" && outcome.rest.memoryScope).toBe("build.health")
  })

  it("applies persona() to agent steps and refuses two identities in one scope", async () => {
    const wf = workflow({
      default: async () => {
        await persona({ model: "smart" }, () => agent("plan.one", "a"))
        await persona({ model: "base" }, () => agent("plan.two", "b"))
      },
    })
    const first = await replayOf(wf, new History())
    expect(
      first.kind === "rest" &&
        first.rest.request.kind === "agent" &&
        first.rest.request.options.model,
    ).toBe("smart")
    const h = new History().land("agent", "plan.one", 1, "plan.two", { a: "1" })
    const outcome = await replayOf(wf, h)
    expect(outcome.kind).toBe("failed")
  })

  it("ends the episode on return and on restart", async () => {
    const returning = workflow({ default: async () => void (await human("only")) })
    const h = new History().land("human", "only", 1, "only")
    expect(await replayOf(returning, h)).toMatchObject({ kind: "ended", via: "return" })

    const restarting = workflow({
      default: async () => {
        await human("first")
        await restart("again")
        await human("never")
      },
    })
    const r = new History().land("human", "first", 1, "first")
    expect(await replayOf(restarting, r)).toMatchObject({ kind: "ended", via: "restart" })
  })

  it("reports refuse() as a refusal and a throw as a failure", async () => {
    const refusing = workflow({
      default: async () => {
        await human("gate")
        if (exists("bad")) refuse("no bad files")
        await human("next")
      },
    })
    const outcome = await replayOf(refusing, new History(), { pending: { bad: "x" } })
    expect(outcome).toEqual({ kind: "refused", message: "no bad files" })

    const throwing = workflow({
      default: async () => {
        throw new Error("boom")
      },
    })
    expect(await replayOf(throwing, new History())).toMatchObject({ kind: "failed" })
  })

  it("fails a flow that awaits something other than a step", async () => {
    const waiting = workflow({
      default: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        await human("late")
      },
    })
    const outcome = await replayOf(waiting, new History())
    expect(outcome.kind === "failed" && outcome.message).toContain("not a step")
  })
})
