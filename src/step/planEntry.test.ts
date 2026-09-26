import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { planEntry, type EntryOutcome } from "./planEntry.js"
import { InMemRepo, testLayers } from "../testing/index.js"
import { ConfigService } from "../workflow/index.js"

const WORKFLOW = `import { agent, human, workflow, refuse } from "@pmelab/gtd/flows"

export default workflow(
  async ({ entry }) => {
    if (entry === "working") {
      await agent("work", "work-prompt")
      return
    }
    if (entry === "reviewcheck") {
      await agent("work", "work-prompt")
      return
    }
    if (entry !== undefined) refuse(\`"\${entry}" is not an enterable state\`)
    await human("idle", { message: "hi" })
    await agent("work", "work-prompt")
  },
  {
    vars: { base: "" },
    base: (entry, vars) => (entry === "reviewcheck" ? (vars.base ?? "") : undefined),
  },
)
`

const repoAt = (): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile("gtd.config.ts", WORKFLOW)
  repo.commitAllWithPrefix("chore: add custom workflow")
  return repo
}

/** Loads the real compiled workflow (via `ConfigService`, same as `Edge.ts`'s `restAt`) so `planEntry`'s entry and `reviewBase` checks see the loaded workflow, then runs `planEntry` against it. */
const enter = (
  repo: InMemRepo,
  state: string,
  actor: string,
  entry: {
    readonly state: string
    readonly commandLabel: string
    readonly vars: Record<string, string>
  },
  entryRefusal?: string,
): Promise<EntryOutcome> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* (yield* ConfigService).load
      return yield* planEntry(
        { def: config.workflow, state, idle: state === config.workflow.initial, entryRefusal },
        actor,
        entry,
      )
    }).pipe(Effect.provide(testLayers(repo))),
  )

describe("planEntry", () => {
  it("refuses when a process is already underway", async () => {
    const repo = repoAt()
    const plan = await enter(repo, "working", "human", {
      state: "working",
      commandLabel: "gtd test",
      vars: {},
    })
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("already underway")
  })

  it("refuses, under the command's label, an entry the flow will not open", async () => {
    const repo = repoAt()
    const plan = await enter(
      repo,
      "idle",
      "human",
      { state: "nonexistent", commandLabel: "gtd test", vars: {} },
      '"nonexistent" is not an enterable state',
    )
    expect(plan).toEqual({
      kind: "refusal",
      message: 'gtd test: "nonexistent" is not an enterable state',
    })
  })

  it("refuses an undeclared --var name", async () => {
    const repo = repoAt()
    const plan = await enter(repo, "idle", "human", {
      state: "working",
      commandLabel: "gtd test",
      vars: { nope: "x" },
    })
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("not declared by this workflow")
  })

  it("refuses a blank-rendering reviewBase template", async () => {
    const repo = repoAt()
    const plan = await enter(repo, "idle", "human", {
      state: "reviewcheck",
      commandLabel: "gtd test",
      vars: {},
    })
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("rendered blank")
  })

  it("succeeds and emits a commitAll + commit-outcome LandStep pair, data only", async () => {
    const repo = repoAt()
    const plan = await enter(repo, "idle", "human", {
      state: "working",
      commandLabel: "gtd test",
      vars: {},
    })
    if (plan.kind !== "entry") throw new Error(`expected entry, got ${plan.kind}`)
    expect(plan.subject).toBe("gtd(human): working")
    expect(plan.steps).toEqual([
      { kind: "gitWrite", write: { kind: "commitAll", message: "gtd(human): working" } },
      { kind: "outcome", outcome: { kind: "commit", subject: "gtd(human): working" } },
    ])
  })

  it("folds --var overrides into a Gtd-Var: trailer on the commit message, never the outcome subject", async () => {
    const repo = repoAt()
    const plan = await enter(repo, "idle", "human", {
      state: "working",
      commandLabel: "gtd test",
      vars: { base: "main" },
    })
    if (plan.kind !== "entry") throw new Error(`expected entry, got ${plan.kind}`)
    const write = plan.steps.find((s) => s.kind === "gitWrite")
    if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
    expect(write.write.message).toBe("gtd(human): working\n\nGtd-Var: base=main")
    const outcome = plan.steps.find((s) => s.kind === "outcome")
    expect(outcome).toEqual({
      kind: "outcome",
      outcome: { kind: "commit", subject: "gtd(human): working" },
    })
  })
})
