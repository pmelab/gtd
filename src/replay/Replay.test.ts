import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  agent,
  changes,
  human,
  judge,
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
const fixLoop = workflow(async () => {
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
      const short = workflow(async () => void (await human("only")))
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
    const wf = workflow(async () => {
      await human("write")
      if (changes(".gtd/*.md").some((c) => c.status === "added"))
        await agent("saw", read(".gtd/NOTE.md") ?? "")
      else await agent("missed", "nothing")
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

  it("reports what the last step changed, with content on both sides", async () => {
    let seen: unknown
    const wf = workflow(async () => {
      for (;;) {
        await human("write")
        seen = changes().map(({ path, status, before, after }) => ({ path, status, before, after }))
      }
    })
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

  it("keeps a local variable across replayed steps", async () => {
    let seen: string | undefined = "unset"
    const wf = workflow(async () => {
      let previous: string | undefined
      for (;;) {
        await run("check", "true")
        seen = previous
        previous = read("OUT")
        await human("look")
      }
    })
    const h = new History()
      .land("check", "check", 1, "look", { OUT: "first" })
      .land("human", "look", 1, "check")
      .land("check", "check", 2, "look", { OUT: "second" })
    await replayOf(wf, h)
    expect(seen).toBe("first")
  })

  it("answers a judge step from its Gtd-Judge trailer", async () => {
    const question = { id: "verdict", primitive: "choice", instructions: "", criteria: "" } as const
    const wf = workflow(async () => {
      const { answers } = await judge("same", { questions: [question], evidence: {} })
      const verdict = answers.verdict
      if (verdict?.answer === "identical" && verdict.p >= 0.7) await human("escalate")
      else await human("retry")
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
    const wf = workflow(() => scope("build", () => scope("health", () => agent("fix", "x"))))
    const outcome = await replayOf(wf, new History())
    expect(restName(outcome)).toBe("build.health.fix#1")
    expect(outcome.kind === "rest" && outcome.rest.memoryScope).toBe("build.health")
  })

  it("gives a scope's model to the agent steps inside, and refuses two identities in one scope", async () => {
    const wf = workflow(() =>
      scope({ model: "smart" }, async () => {
        await agent("one", "a")
        await scope({ name: "plan", model: "base" }, () => agent("two", "b"))
        await agent("three", "c", { model: "base" })
      }),
    )
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
    const returning = workflow(async () => void (await human("only")))
    const h = new History().land("human", "only", 1, "only")
    expect(await replayOf(returning, h)).toMatchObject({ kind: "ended", via: "return" })

    const restarting = workflow(async () => {
      await human("first")
      await restart()
      await human("never")
    })
    const r = new History().land("human", "first", 1, "first")
    expect(await replayOf(restarting, r)).toMatchObject({ kind: "ended", via: "restart" })
  })

  it("reports refuse() as a refusal and a throw as a failure", async () => {
    const refusing = workflow(async () => {
      await human("gate")
      if (read("bad") !== undefined) refuse("no bad files")
      await human("next")
    })
    const outcome = await replayOf(refusing, new History(), { pending: { bad: "x" } })
    expect(outcome).toEqual({ kind: "refused", message: "no bad files" })

    const throwing = workflow(async () => {
      throw new Error("boom")
    })
    expect(await replayOf(throwing, new History())).toMatchObject({ kind: "failed" })
  })

  it("fails a flow that awaits something other than a step", async () => {
    const waiting = workflow(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      await human("late")
    })
    const outcome = await replayOf(waiting, new History())
    expect(outcome.kind === "failed" && outcome.message).toContain("not a step")
  })
})
