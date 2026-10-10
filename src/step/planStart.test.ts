import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { planStart, type StartOutcome } from "./planStart.js"
import { InMemRepo, testLayers } from "../testing/index.js"
import { ConfigService } from "../workflow/index.js"

const WORKFLOW = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle", { message: "hi" })
  await agent("work", "work-prompt")
}

export const working = async () => {
  await agent("work", "work-prompt")
}

export const reviewcheck = async () => {
  await agent("work", "work-prompt")
}

export const defaults = { base: "" }

export const base = (workflow, vars) => (workflow === "reviewcheck" ? (vars.base ?? "") : undefined)
`

const repoAt = (): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile("gtd.config.ts", WORKFLOW)
  repo.commitAllWithPrefix("chore: add custom workflow")
  return repo
}

/** Loads the real compiled workflows (via `ConfigService`, same as `Edge.ts`'s `restAt`) so `planStart`'s checks see the loaded workflow, then runs `planStart` against it. */
const start = (
  repo: InMemRepo,
  state: string,
  actor: string,
  req: {
    readonly workflow: string
    readonly commandLabel: string
    readonly vars: Record<string, string>
  },
  startRefusal?: string,
): Promise<StartOutcome> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* (yield* ConfigService).load
      const workflow = config.workflowNamed(req.workflow)
      if (workflow === undefined) throw new Error(`no workflow ${req.workflow}`)
      return yield* planStart({ state, idle: state === config.workflow.initial }, actor, {
        workflow,
        first: startRefusal === undefined ? { firstStep: "work" } : { refusal: startRefusal },
        commandLabel: req.commandLabel,
        vars: req.vars,
      })
    }).pipe(Effect.provide(testLayers(repo))),
  )

describe("planStart", () => {
  it("refuses when a process is already underway", async () => {
    const repo = repoAt()
    const plan = await start(repo, "working", "human", {
      workflow: "working",
      commandLabel: "gtd test",
      vars: {},
    })
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("already underway")
  })

  it("refuses, under the command's label, a workflow that will not start", async () => {
    const repo = repoAt()
    const plan = await start(
      repo,
      "idle",
      "human",
      { workflow: "working", commandLabel: "gtd test", vars: {} },
      'workflow "working" cannot start — it reaches no step',
    )
    expect(plan).toEqual({
      kind: "refusal",
      message: 'gtd test: workflow "working" cannot start — it reaches no step',
    })
  })

  it("refuses an undeclared --var name", async () => {
    const repo = repoAt()
    const plan = await start(repo, "idle", "human", {
      workflow: "working",
      commandLabel: "gtd test",
      vars: { nope: "x" },
    })
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("not declared by this workflow")
  })

  describe("a workflow's diff base", () => {
    const REVIEW = { workflow: "reviewcheck", commandLabel: "gtd test" }

    it("resolves a blank base to the default branch's merge-base with HEAD", async () => {
      const repo = repoAt()
      const fork = repo.resolveRef("HEAD")!
      repo.updateRef("main", fork)
      repo.writeFile("a.txt", "a")
      repo.commitAllWithPrefix("feat: ahead of main")
      const plan = await start(repo, "idle", "human", { ...REVIEW, vars: {} })
      if (plan.kind !== "start") throw new Error(`expected start, got ${JSON.stringify(plan)}`)
      const write = plan.steps.find((s) => s.kind === "gitWrite")
      if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
      expect(write.write.message).toContain(`Gtd-Review-Base: ${fork}`)
    })

    it("pins the merge-base, not the named base, when the base has diverged", async () => {
      const repo = repoAt()
      const fork = repo.resolveRef("HEAD")!
      repo.writeFile("other.txt", "o")
      repo.commitAllWithPrefix("feat: other branch")
      repo.updateRef("other", repo.resolveRef("HEAD")!)
      repo.hardResetTo(fork)
      repo.writeFile("mine.txt", "m")
      repo.commitAllWithPrefix("feat: my branch")
      const plan = await start(repo, "idle", "human", { ...REVIEW, vars: { base: "other" } })
      if (plan.kind !== "start") throw new Error(`expected start, got ${JSON.stringify(plan)}`)
      const write = plan.steps.find((s) => s.kind === "gitWrite")
      if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
      expect(write.write.message).toContain(`Gtd-Review-Base: ${fork}`)
    })

    it("refuses a base that does not resolve", async () => {
      const plan = await start(repoAt(), "idle", "human", { ...REVIEW, vars: { base: "nope" } })
      expect(plan).toEqual({
        kind: "refusal",
        message: 'gtd test: "nope" does not resolve to a commit',
      })
    })

    it("refuses a base that shares no common ancestor with HEAD", async () => {
      const repo = repoAt()
      repo.updateRef("old-root", repo.resolveRef("HEAD")!)
      repo.mixedResetTo("4b825dc642cb6eb9a060e54bf8d69288fbee4904")
      repo.writeFile("gtd.config.ts", WORKFLOW)
      repo.commitAllWithPrefix("chore: a second root")
      const plan = await start(repo, "idle", "human", { ...REVIEW, vars: { base: "old-root" } })
      expect(plan).toEqual({
        kind: "refusal",
        message: 'gtd test: "old-root" shares no common ancestor with HEAD',
      })
    })

    it("refuses when HEAD has no commits beyond the base", async () => {
      const repo = repoAt()
      const plan = await start(repo, "idle", "human", { ...REVIEW, vars: {} })
      expect(plan).toEqual({
        kind: "refusal",
        message: "gtd test: nothing to review: HEAD has no commits beyond main",
      })
    })
  })

  it("succeeds and emits a commitAll + commit-outcome LandStep pair, data only", async () => {
    const repo = repoAt()
    const plan = await start(repo, "idle", "human", {
      workflow: "working",
      commandLabel: "gtd test",
      vars: {},
    })
    if (plan.kind !== "start") throw new Error(`expected start, got ${plan.kind}`)
    expect(plan.subject).toBe("gtd(human): work")
    expect(plan.steps).toEqual([
      {
        kind: "gitWrite",
        write: {
          kind: "commitAll",
          message: "gtd(human): work\n\nGtd-Workflow: working\nGtd-Var: base=\nGtd-Format: 1",
        },
      },
      { kind: "outcome", outcome: { kind: "commit", subject: "gtd(human): work" } },
    ])
  })

  it("folds --var overrides into a Gtd-Var: trailer on the commit message, never the outcome subject", async () => {
    const repo = repoAt()
    const plan = await start(repo, "idle", "human", {
      workflow: "working",
      commandLabel: "gtd test",
      vars: { base: "main" },
    })
    if (plan.kind !== "start") throw new Error(`expected start, got ${plan.kind}`)
    const write = plan.steps.find((s) => s.kind === "gitWrite")
    if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
    expect(write.write.message).toBe(
      "gtd(human): work\n\nGtd-Workflow: working\nGtd-Var: base=main\nGtd-Format: 1",
    )
    const outcome = plan.steps.find((s) => s.kind === "outcome")
    expect(outcome).toEqual({
      kind: "outcome",
      outcome: { kind: "commit", subject: "gtd(human): work" },
    })
  })
})
