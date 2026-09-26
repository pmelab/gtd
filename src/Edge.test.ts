import { Effect, Exit } from "effect"
import { describe, expect, it, vi } from "vitest"
import { runCli } from "./cli/index.js"
import {
  currentRest,
  currentRun,
  noProcessUnderway,
  renderRest,
  restAt,
  restIsIdle,
  reviewBaseFor,
  snapshotFromRest,
  stalledAt,
  summaryRun,
  TRUNCATION_NOTICE,
  UNATTRIBUTED_MODEL,
  type RestRequirements,
} from "./Edge.js"
import { formatCommitMessage, type CommitSpec } from "./replay/index.js"
import { InMemRepo, applyEmittedScript, makeCapturingCliIo, testLayers } from "./testing/index.js"

type Env = Readonly<Record<string, string | undefined>>
type Files = Readonly<Record<string, string>>

const provide = <A>(
  eff: Effect.Effect<A, Error, RestRequirements>,
  repo: InMemRepo,
  env: Env = {},
): Promise<A> => Effect.runPromise(eff.pipe(Effect.provide(testLayers(repo, { env }))))

const provideExit = <A>(
  eff: Effect.Effect<A, Error, RestRequirements>,
  repo: InMemRepo,
  env: Env = {},
): Promise<Exit.Exit<A, Error>> =>
  Effect.runPromiseExit(eff.pipe(Effect.provide(testLayers(repo, { env }))))

const write = (repo: InMemRepo, files: Files): void => {
  for (const [path, content] of Object.entries(files)) repo.writeFile(path, content)
}

const headOf = (repo: InMemRepo): string => repo.resolveRef("HEAD")!

const repoWith = (config: string, files: Files = {}): InMemRepo => {
  const repo = new InMemRepo()
  write(repo, { "gtd.config.ts": config, ...files })
  repo.commitAllWithPrefix("chore: add workflow")
  return repo
}

const cli = async (repo: InMemRepo, ...args: string[]) => {
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", ...args], io))
  return result()
}

const applied = (repo: InMemRepo, script: string): string => {
  const outcome = applyEmittedScript(repo, new Map(), script)
  if (!outcome.ok) throw new Error(outcome.error)
  return headOf(repo)
}

/** Lands the pending turn the way a driver does — `gtd land --json`, then its script — and returns the new HEAD. */
const land = async (repo: InMemRepo, files: Files = {}): Promise<string> => {
  write(repo, files)
  const { stdout, stderr, exitCode } = await cli(repo, "land", "--json")
  if (exitCode !== 0) throw new Error(`gtd land exited ${exitCode}: ${stderr}${stdout}`)
  return applied(repo, (JSON.parse(stdout) as { readonly script: string }).script)
}

const enter = async (repo: InMemRepo, entry: string, ...vars: string[]): Promise<string> => {
  const flags = vars.flatMap((v) => ["--var", v])
  const { stdout, stderr, exitCode } = await cli(repo, "--entry", entry, ...flags)
  if (exitCode !== 0) throw new Error(`gtd --entry exited ${exitCode}: ${stderr}`)
  return applied(repo, stdout)
}

/** Commits an exact message — for trailers no landing writes on its own. */
const commit = (repo: InMemRepo, spec: CommitSpec, files: Files = {}): string => {
  write(repo, files)
  repo.commitAllWithPrefix(formatCommitMessage(spec))
  return headOf(repo)
}

const LINEAR = `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow(
  {
    default: async () => {
      await human("idle", { message: "idle-message" })
      await agent("building", "build-prompt")
      await agent("checking", "check-prompt")
    },
    side: async () => {
      await agent("fixing", "fix-prompt")
      await agent("tidying", "tidy-prompt", { allowEmpty: true })
    },
    review: {
      flow: async () => {
        await agent("fixing", "fix-prompt")
      },
      base: (vars) => vars.base ?? "",
    },
  },
  { vars: { base: "", reviewer: "nobody" } },
)
`

describe("currentRun", () => {
  it("is empty at a non-gtd HEAD, which is both its start and its parent", async () => {
    const repo = repoWith(LINEAR)
    const boundary = headOf(repo)
    const run = await provide(currentRun, repo)
    expect(run).toMatchObject({
      entry: "default",
      startHash: boundary,
      startParentHash: boundary,
      diffBase: boundary,
      trace: [],
      costEntries: [],
      judgeVerdicts: [],
      entryVars: {},
      headTurn: undefined,
      closingHash: undefined,
      episode: { base: boundary, commits: [] },
    })
  })

  it("traces each step commit back to the nearest non-gtd commit", async () => {
    const repo = repoWith(LINEAR)
    const boundary = headOf(repo)
    const building = await land(repo, { "a.txt": "a\n" })
    const checking = await land(repo, { "b.txt": "b\n" })
    const run = await provide(currentRun, repo)
    expect(run.startParentHash).toBe(boundary)
    expect(run.startHash).toBe(building)
    expect(run.trace).toEqual([
      { state: "building", hash: building, actor: "human" },
      { state: "checking", hash: checking, actor: "agent" },
    ])
    expect(run.episode.base).toBe(boundary)
    expect(run.episode.commits.map((c) => c.hash)).toEqual([building, checking])
  })

  it("a non-gtd commit on top of a process bounds a fresh episode", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    repo.writeFile("b.txt", "b\n")
    repo.commitAllWithPrefix("feat: unrelated")
    const run = await provide(currentRun, repo)
    expect(run.trace).toEqual([])
    expect(run.startParentHash).toBe(headOf(repo))
  })

  it("a commit entering the default entry's first step closes the episode", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    const closing = await land(repo, { "c.txt": "c\n" })
    expect(repo.lastCommitSubject()).toBe("gtd(agent): checking → idle")
    const next = await land(repo, { "d.txt": "d\n" })
    const run = await provide(currentRun, repo)
    expect(run.startParentHash).toBe(closing)
    expect(run.trace).toEqual([{ state: "building", hash: next, actor: "human" }])
  })

  it("a trailer-less gtd(human): <entry> commit opens a manual entry's episode as its first commit", async () => {
    const repo = repoWith(LINEAR)
    const before = headOf(repo)
    const opening = await enter(repo, "side")
    expect(repo.lastCommitMessage()).toBe("gtd(human): side")
    const fixed = await land(repo, { "fix.txt": "x\n" })
    const run = await provide(currentRun, repo)
    expect(run.entry).toBe("side")
    expect(run.startHash).toBe(opening)
    expect(run.startParentHash).toBe(before)
    expect(run.trace).toEqual([
      { state: "side", hash: opening, actor: "human" },
      { state: "tidying", hash: fixed, actor: "agent" },
    ])
    expect(run.episode.base).toBe(opening)
    expect(run.episode.commits.map((c) => c.hash)).toEqual([fixed])
  })

  it("collects every process commit's Gtd-Cost, attributing a model-less one to UNATTRIBUTED_MODEL", async () => {
    const repo = repoWith(LINEAR)
    commit(
      repo,
      {
        actor: "human",
        from: "idle",
        to: "building",
        step: { name: "idle", occurrence: 1 },
        cost: { cost: 120, model: "opus" },
      },
      { "a.txt": "a\n" },
    )
    commit(repo, { actor: "agent", to: "building", cost: { cost: 50 } })
    commit(
      repo,
      {
        actor: "agent",
        from: "building",
        to: "checking",
        step: { name: "building", occurrence: 1 },
        cost: { cost: 300, model: "haiku" },
      },
      { "b.txt": "b\n" },
    )
    const run = await provide(currentRun, repo)
    expect(run.costEntries).toEqual([
      { cost: 120, model: "opus" },
      { cost: 50, model: UNATTRIBUTED_MODEL },
      { cost: 300, model: "haiku" },
    ])
  })

  it("collects every Gtd-Judge verdict oldest first, skipping one that is not valid JSON", async () => {
    const repo = repoWith(LINEAR)
    commit(
      repo,
      {
        actor: "human",
        from: "idle",
        to: "building",
        step: { name: "idle", occurrence: 1 },
        judge: [{ id: "q1", answer: true, p: 0.97 }],
      },
      { "a.txt": "a\n" },
    )
    repo.writeFile("b.txt", "b\n")
    repo.commitAllWithPrefix(
      [
        "gtd(agent): building → checking",
        "",
        "Gtd-Step: building#1",
        "Gtd-Judge: not json",
        'Gtd-Judge: {"id":"q2","answer":3,"p":0.8}',
      ].join("\n"),
    )
    const run = await provide(currentRun, repo)
    expect(run.judgeVerdicts).toEqual([
      { id: "q1", answer: true, p: 0.97 },
      { id: "q2", answer: 3, p: 0.8 },
    ])
  })

  it("the opening commit's Gtd-Review-Base overrides diffBase, leaving startParentHash alone", async () => {
    const repo = repoWith(LINEAR)
    const base = headOf(repo)
    repo.writeFile("later.txt", "later\n")
    repo.commitAllWithPrefix("feat: later")
    const before = headOf(repo)
    await enter(repo, "review", `base=${base}`)
    const run = await provide(currentRun, repo)
    expect(run.startParentHash).toBe(before)
    expect(run.diffBase).toBe(base)
  })

  it("a Gtd-Review-Base on a later process commit is never consulted", async () => {
    const repo = repoWith(LINEAR)
    const boundary = headOf(repo)
    await land(repo, { "a.txt": "a\n" })
    commit(
      repo,
      {
        actor: "agent",
        from: "building",
        to: "checking",
        step: { name: "building", occurrence: 1 },
        reviewBase: "not-the-real-base",
      },
      { "b.txt": "b\n" },
    )
    const run = await provide(currentRun, repo)
    expect(run.diffBase).toBe(boundary)
  })

  it("reads entryVars off a manual entry's opening commit", async () => {
    const repo = repoWith(LINEAR)
    await enter(repo, "side", "base=main", "reviewer=alice")
    await land(repo, { "fix.txt": "x\n" })
    const run = await provide(currentRun, repo)
    expect(run.entryVars).toEqual({ base: "main", reviewer: "alice" })
  })

  it("a default-entry episode has no entryVars, even when its first commit carries Gtd-Var", async () => {
    const repo = repoWith(LINEAR)
    commit(
      repo,
      {
        actor: "human",
        from: "idle",
        to: "building",
        step: { name: "idle", occurrence: 1 },
        vars: { reviewer: "alice" },
      },
      { "a.txt": "a\n" },
    )
    const run = await provide(currentRun, repo)
    expect(run.entryVars).toEqual({})
  })

  describe("headTurn", () => {
    it("describes a step commit that changed something", async () => {
      const repo = repoWith(LINEAR)
      await land(repo, { "a.txt": "a\n" })
      const run = await provide(currentRun, repo)
      expect(run.headTurn).toEqual({ state: "building", actor: "human", empty: false, step: true })
    })

    it("describes an attempt: a bare, trailer-less, empty commit", async () => {
      const repo = repoWith(LINEAR)
      await land(repo, { "a.txt": "a\n" })
      await land(repo)
      expect(repo.lastCommitMessage()).toBe("gtd(agent): building")
      const run = await provide(currentRun, repo)
      expect(run.headTurn).toEqual({ state: "building", actor: "agent", empty: true, step: false })
    })

    it("is undefined at a non-gtd HEAD", async () => {
      const repo = repoWith(LINEAR)
      const run = await provide(currentRun, repo)
      expect(run.headTurn).toBeUndefined()
    })
  })
})

describe("summaryRun", () => {
  it("matches currentRun while the process is in flight", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    const [ordinary, summary] = await Promise.all([
      provide(currentRun, repo),
      provide(summaryRun, repo),
    ])
    expect(summary).toEqual(ordinary)
    expect(summary.closingHash).toBeUndefined()
  })

  it("at a closing HEAD, keeps the closed process and folds the closing commit into its trace", async () => {
    const repo = repoWith(LINEAR)
    const boundary = headOf(repo)
    const building = await land(repo, { "a.txt": "a\n" })
    const checking = await land(repo, { "b.txt": "b\n" })
    const closing = await land(repo, { "c.txt": "c\n" })

    const ordinary = await provide(currentRun, repo)
    expect(ordinary.trace).toEqual([])
    expect(ordinary.startParentHash).toBe(closing)

    const summary = await provide(summaryRun, repo)
    expect(summary.closingHash).toBe(closing)
    expect(summary.startParentHash).toBe(boundary)
    expect(summary.trace).toEqual([
      { state: "building", hash: building, actor: "human" },
      { state: "checking", hash: checking, actor: "agent" },
      { state: "idle", hash: closing, actor: "agent" },
    ])
  })

  it("no longer reaches a closed process once another commit lands on top", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    await land(repo, { "c.txt": "c\n" })
    repo.writeFile("d.txt", "d\n")
    repo.commitAllWithPrefix("chore: unrelated")
    const summary = await provide(summaryRun, repo)
    expect(summary.closingHash).toBeUndefined()
    expect(summary.trace).toEqual([])
  })
})

describe("restAt", () => {
  it("restAt(ref) resolves where the process rested at that commit", async () => {
    const repo = repoWith(LINEAR)
    const boundary = headOf(repo)
    await land(repo, { "a.txt": "a\n" })
    expect((await provide(currentRest, repo)).state).toBe("building")
    expect((await provide(restAt(boundary), repo)).state).toBe("idle")
  })

  it("ignores a stray refs/worktree/gtd/review-head ref", async () => {
    const repo = repoWith(LINEAR)
    const boundary = headOf(repo)
    const building = await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    repo.updateRef("refs/worktree/gtd/review-head", building)
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("checking")
    expect(rest.run.startParentHash).toBe(boundary)
  })

  it("narrates the resolved step and who it awaits", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    const lines: string[] = []
    await Effect.runPromise(
      currentRest.pipe(Effect.provide(testLayers(repo, { narrate: (line) => lines.push(line) }))),
    )
    expect(lines).toContain("rest resolved: building (awaits agent)\n")
  })

  it("refuses a rest whose step names a mode no layer declares", async () => {
    const repo = repoWith(`import { human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle", { file: "docs/adr.md", mode: "adr" })
  },
})
`)
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
      'step "idle": mode "adr" is not a mode this workflow knows (qa, review)',
    )
  })

  it("refuses a step option the step does not accept, naming a retired one's replacement", async () => {
    const repo = repoWith(`import { agent, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await agent("work", "p", { memory: "plan" })
  },
})
`)
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
      'step "work": unknown key(s) memory in agent() options',
    )
  })
})

describe("reviewBaseFor", () => {
  const LOOP = `import { agent, exists, human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle")
    while (!exists("DONE")) {
      await human("checkpoint", { reviewBase: true })
      await agent("building", "build-prompt")
    }
  },
  review: {
    flow: async () => {
      await agent("fixing", "fix-prompt")
    },
    base: (vars) => vars.base ?? "",
  },
}, { vars: { base: "" } })
`

  it("is the process's diff base before any reviewBase step is reached", async () => {
    const repo = repoWith(LOOP)
    const rest = await provide(currentRest, repo)
    expect(reviewBaseFor(rest)).toBe(rest.run.diffBase)
  })

  it("is the commit that entered the latest reviewBase step", async () => {
    const repo = repoWith(LOOP)
    const first = await land(repo, { "a.txt": "a\n" })
    expect(reviewBaseFor(await provide(currentRest, repo))).toBe(first)
    await land(repo, { "b.txt": "b\n" })
    expect(reviewBaseFor(await provide(currentRest, repo))).toBe(first)
    const second = await land(repo, { "c.txt": "c\n" })
    const atCheckpoint = await provide(currentRest, repo)
    expect(atCheckpoint.state).toBe("checkpoint")
    expect(reviewBaseFor(atCheckpoint)).toBe(second)
    await land(repo, { "d.txt": "d\n" })
    expect(reviewBaseFor(await provide(currentRest, repo))).toBe(second)
  })

  it("falls back to an entry's Gtd-Review-Base", async () => {
    const repo = repoWith(LOOP)
    const base = headOf(repo)
    repo.writeFile("later.txt", "later\n")
    repo.commitAllWithPrefix("feat: later")
    await enter(repo, "review", `base=${base}`)
    expect(reviewBaseFor(await provide(currentRest, repo))).toBe(base)
  })
})

describe("memory", () => {
  const SCOPED = `import { agent, exists, human, scope, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle")
    do await agent("build", "b")
    while (!exists("ROOT_DONE"))
    for (const round of [1, 2]) {
      await scope("a", async () => {
        await agent("work", "a")
        if (round === 2) {
          await scope("child", () => agent("work", "c"))
          await agent("again", "a-again")
        }
      })
      if (round === 1) await scope("b", () => agent("work", "b"))
    }
  },
})
`

  const memoryAt = async (repo: InMemRepo) => {
    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    return { state: rest.state, key: rest.memory, resumed: rendered.memoryResumed, rendered }
  }

  it("keys each agent rest by <scope>#<hash7>, resuming only within one unbroken run of its scope", async () => {
    const repo = repoWith(SCOPED)
    const boundary = headOf(repo)
    let n = 0
    const next = () => land(repo, { [`f${n++}.txt`]: "x\n" })

    const idle = await memoryAt(repo)
    expect(idle).toMatchObject({ state: "idle", key: undefined, resumed: false })
    expect(idle.rendered).not.toHaveProperty("memory")

    await next()
    const rootKey = `root#${boundary.slice(0, 7)}`
    expect(await memoryAt(repo)).toMatchObject({ state: "build", key: rootKey, resumed: false })

    await next()
    expect(await memoryAt(repo)).toMatchObject({ state: "build", key: rootKey, resumed: true })

    await land(repo, { ROOT_DONE: "" })
    const firstA = await memoryAt(repo)
    expect(firstA).toMatchObject({ state: "a.work", resumed: false })
    expect(firstA.key).toMatch(/^a#[0-9a-f]{7}$/)

    await next()
    expect(await memoryAt(repo)).toMatchObject({ state: "b.work", resumed: false })

    await next()
    const secondA = await memoryAt(repo)
    expect(secondA).toMatchObject({ state: "a.work", resumed: false })
    expect(secondA.key).toMatch(/^a#[0-9a-f]{7}$/)
    expect(secondA.key).not.toBe(firstA.key)

    await next()
    expect((await memoryAt(repo)).key).toMatch(/^a\.child#[0-9a-f]{7}$/)

    await next()
    expect(await memoryAt(repo)).toMatchObject({
      state: "a.again",
      key: secondA.key,
      resumed: true,
    })
  })
  it("never resumes a session only a child scope's turn created", async () => {
    const repo = repoWith(`import { agent, human, scope, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle")
    await scope("child", () => agent("work", "c"))
    await agent("build", "b")
  },
})
`)
    await land(repo, { "start.txt": "x\n" })
    await land(repo, { "child.txt": "x\n" })
    expect(await memoryAt(repo)).toMatchObject({ state: "build", resumed: false })
  })
})

describe("vars", () => {
  const VARS = `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow(
  {
    default: async () => {
      await human("idle")
    },
    side: async () => {
      await agent("working", "w")
    },
  },
  { vars: { testCommand: "npm test", reviewer: "nobody" } },
)
`
  const seeded = () => repoWith(VARS, { ".gtdrc.yaml": "vars:\n  testCommand: npm run rc\n" })

  it("a .gtdrc vars: entry overrides the workflow's default", async () => {
    const rest = await provide(currentRest, seeded())
    expect(rest.vars).toEqual({ testCommand: "npm run rc", reviewer: "nobody" })
  })

  it("an entry's Gtd-Var overrides both the workflow default and .gtdrc", async () => {
    const repo = seeded()
    await enter(repo, "side", "testCommand=npm run entry")
    const rest = await provide(currentRest, repo)
    expect(rest.vars.testCommand).toBe("npm run entry")
  })

  it("GTD_<NAME> beats every other layer", async () => {
    const repo = seeded()
    await enter(repo, "side", "testCommand=npm run entry")
    const rest = await provide(currentRest, repo, { GTD_TESTCOMMAND: "echo env-wins" })
    expect(rest.vars.testCommand).toBe("echo env-wins")
  })

  it("ignores a GTD_ env var naming no declared var", async () => {
    const rest = await provide(currentRest, seeded(), { GTD_BRANDNEW: "hello" })
    expect(Object.keys(rest.vars).sort()).toEqual(["reviewer", "testCommand"])
  })
})

describe("stalledAt", () => {
  it("is true on a clean tree when HEAD is an empty attempt at this agent rest", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    await land(repo)
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("building")
    expect(stalledAt(rest)).toBe(true)
  })

  it("is false on a dirty tree", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    await land(repo)
    repo.writeFile("scratch.txt", "x\n")
    expect(stalledAt(await provide(currentRest, repo))).toBe(false)
  })

  it("is false when HEAD's turn changed something", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    expect(stalledAt(await provide(currentRest, repo))).toBe(false)
  })

  it("is false at an allowEmpty step, even with an empty attempt at HEAD", async () => {
    const repo = repoWith(LINEAR)
    await enter(repo, "side")
    await land(repo, { "fix.txt": "x\n" })
    repo.commitAllWithPrefix("gtd(agent): tidying")
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("tidying")
    expect(stalledAt(rest)).toBe(false)
  })
})

describe("noProcessUnderway / restIsIdle", () => {
  it("both hold at the default entry's first step on a clean tree", async () => {
    const rest = await provide(currentRest, repoWith(LINEAR))
    expect(noProcessUnderway(rest)).toBe(true)
    expect(restIsIdle(rest)).toBe(true)
  })

  it("a dirty tree there is a turn not yet landed — no process, but not idle", async () => {
    const repo = repoWith(LINEAR)
    repo.writeFile("a.txt", "a\n")
    const rest = await provide(currentRest, repo)
    expect(noProcessUnderway(rest)).toBe(true)
    expect(restIsIdle(rest)).toBe(false)
  })

  it("neither holds once a turn has landed", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    const rest = await provide(currentRest, repo)
    expect(noProcessUnderway(rest)).toBe(false)
    expect(restIsIdle(rest)).toBe(false)
  })

  it("neither holds inside a manual entry", async () => {
    const repo = repoWith(LINEAR)
    await enter(repo, "side")
    expect(noProcessUnderway(await provide(currentRest, repo))).toBe(false)
  })

  it("both hold again once the process closes", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    await land(repo, { "c.txt": "c\n" })
    expect(restIsIdle(await provide(currentRest, repo))).toBe(true)
  })
})

describe("renderRest — skills preamble", () => {
  const SKILLS = (opts: { readonly skills?: string; readonly preamble?: string }) =>
    `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow(
  {
    default: async () => {
      await human("idle", { message: "hello" })
      await agent("working", "do-the-work", ${JSON.stringify(opts.skills === undefined ? {} : { skills: opts.skills })})
    },
  },
  { vars: { skillsPreamble: ${JSON.stringify(opts.preamble ?? "Load: <%= it.skills %>")} } },
)
`

  const contentAt = async (config: string, landFirst: boolean): Promise<string> => {
    const repo = repoWith(config)
    if (landFirst) await land(repo, { "a.txt": "a\n" })
    return (await provide(renderRest(await provide(currentRest, repo)), repo)).content
  }

  it("prepends the rendered preamble to a prompt, joined by two newlines", async () => {
    expect(await contentAt(SKILLS({ skills: "code-review, testing" }), true)).toBe(
      "Load: code-review, testing\n\ndo-the-work",
    )
  })

  it("leaves a prompt untouched when the step declares no skills", async () => {
    expect(await contentAt(SKILLS({}), true)).toBe("do-the-work")
  })

  it("leaves a prompt untouched when skillsPreamble is blank", async () => {
    expect(await contentAt(SKILLS({ skills: "code-review", preamble: "  " }), true)).toBe(
      "do-the-work",
    )
  })

  it("never touches the message of a step before the prompt", async () => {
    expect(await contentAt(SKILLS({ skills: "code-review" }), false)).toBe("hello")
  })
})

describe("judge rests", () => {
  const JUDGED = (
    budget: string,
  ) => `import { human, judge, tail, workflow } from "@pmelab/gtd/flows"

export default workflow(
  {
    default: async () => {
      await human("idle")
      await judge(
        "verdict",
        { id: "q", primitive: "noul", instructions: "i", criteria: "c" },
        { log: tail("LOG.md", 1) },
        { message: "judge-message" },
      )
    },
  },
  { vars: { judgeBudgetBytes: ${JSON.stringify(budget)} } },
)
`
  const LOG = Array.from({ length: 10 }, (_, i) => `line ${i} of the log`).join("\n") + "\n"

  const judgedAt = async (budget: string) => {
    const repo = repoWith(JUDGED(budget), { "LOG.md": LOG })
    await land(repo, { "a.txt": "a\n" })
    const rest = await provide(currentRest, repo)
    return { rest, rendered: await provide(renderRest(rest), repo) }
  }

  it("appends the truncation notice when a bounded read dropped evidence", async () => {
    const { rest, rendered } = await judgedAt("40")
    expect(rest.state).toBe("verdict")
    expect(rendered.kind).toBe("message")
    expect(rendered.content).toBe(`judge-message\n\n${TRUNCATION_NOTICE}`)
    expect(rendered.truncated).toBe(true)
    expect(rendered.judge).not.toContain("line 0 of the log")
  })

  it("leaves the message alone when nothing was cut", async () => {
    const { rendered } = await judgedAt("32768")
    expect(rendered.content).toBe("judge-message")
    expect(rendered.truncated).toBe(false)
    expect(rendered.judge).toContain("line 0 of the log")
  })

  it.each(["", "not-a-number", "0", "-1", "1.5"])(
    "refuses to resolve the rest when judgeBudgetBytes is %j",
    async (budget) => {
      const exit = await provideExit(currentRest, repoWith(JUDGED(budget), { "LOG.md": LOG }))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(String(Exit.isFailure(exit) && exit.cause)).toContain("judgeBudgetBytes")
    },
  )
})

describe("snapshotFromRest", () => {
  const REVERT = `import { agent, human, workflow } from "@pmelab/gtd/flows"

export default workflow({
  default: async () => {
    await human("idle")
    await human("reviewed", { reviewBase: true })
    await agent("awaitRevert", "revert-it", { requireRevert: true, file: ".gtd/AWAIT.md" })
  },
})
`

  /** At `awaitRevert`, whose review round is the idle turn that touched `src/reviewed.ts`. */ // gtd-path-exempt: in-memory fixture
  const revertRepo = async (): Promise<InMemRepo> => {
    const repo = repoWith(REVERT)
    await land(repo, { "src/reviewed.ts": "reviewed\n" })
    await land(repo, { ".gtd/NOTE.md": "note\n" })
    return repo
  }

  it("skips the require-revert probe for an attempt", async () => {
    const repo = await revertRepo()
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("awaitRevert")
    const history = vi.spyOn(repo, "commitHistory")
    const snapshot = await provide(snapshotFromRest(rest), repo)
    expect(snapshot.landing.kind).toBe("attempt")
    expect(snapshot.revert).toEqual({ checked: false, base: "", residue: [] })
    expect(history).not.toHaveBeenCalled()
  })

  it("probes the review round's code paths for a landing that commits", async () => {
    const repo = await revertRepo()
    repo.writeFile("src/a.ts", "a\n")
    const kept = await provide(snapshotFromRest(await provide(currentRest, repo)), repo)
    expect(kept.landing.kind).toBe("commit")
    expect(kept.revert.checked).toBe(true)
    expect(kept.revert.residue).toEqual(["src/reviewed.ts"])

    repo.deleteFile("src/reviewed.ts")
    const reverted = await provide(snapshotFromRest(await provide(currentRest, repo)), repo)
    expect(reverted.revert).toMatchObject({ checked: true, residue: [] })
  })

  it("skips the probe at a step that does not require a revert", async () => {
    const repo = repoWith(REVERT)
    await land(repo, { "src/reviewed.ts": "reviewed\n" })
    repo.writeFile("src/a.ts", "a\n")
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("reviewed")
    const snapshot = await provide(snapshotFromRest(rest), repo)
    expect(snapshot.landing.kind).toBe("commit")
    expect(snapshot.revert.checked).toBe(false)
  })

  it("reads the declared steering file at HEAD and in the worktree", async () => {
    const repo = await revertRepo()
    repo.writeFile(".gtd/AWAIT.md", "pending content\n")
    const snapshot = await provide(snapshotFromRest(await provide(currentRest, repo)), repo)
    expect(snapshot.file).toBe(".gtd/AWAIT.md")
    expect(snapshot.headFile).toBeUndefined()
    expect(snapshot.worktreeFile).toBe("pending content\n")
  })

  it("reads no file at a step that declares none", async () => {
    const repo = repoWith(REVERT)
    const snapshot = await provide(snapshotFromRest(await provide(currentRest, repo)), repo)
    expect(snapshot.file).toBeUndefined()
    expect(snapshot.headFile).toBeUndefined()
    expect(snapshot.worktreeFile).toBeUndefined()
  })
})
