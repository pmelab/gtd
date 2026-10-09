import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
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
import { GitService, Workspace, type GitOperations, type WorkspaceOps } from "./platform/index.js"
import { formatCommitMessage, type CommitSpec } from "./replay/index.js"
import {
  fakeGitOperations,
  InMemRepo,
  applyEmittedScript,
  makeCapturingCliIo,
  makeInMemoryWorkspaceOps,
  testLayers,
} from "./testing/index.js"

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

/** Like `provide`, but with `git` swapping in for the run's `GitService` — for tests that need to observe or interfere with the exact git calls a run makes. */
const provideWithGit = <A>(
  eff: Effect.Effect<A, Error, RestRequirements>,
  git: GitOperations,
  repo: InMemRepo,
  env: Env = {},
): Promise<A> =>
  Effect.runPromise(
    eff.pipe(Effect.provideService(GitService, git), Effect.provide(testLayers(repo, { env }))),
  )

/** Like `provideWithGit`, but with `workspace` swapping in for the run's `Workspace` — for tests observing exactly when `worktreeSync` runs. */
const provideWithWorkspace = <A>(
  eff: Effect.Effect<A, Error, RestRequirements>,
  workspace: WorkspaceOps,
  repo: InMemRepo,
): Promise<A> =>
  Effect.runPromise(
    eff.pipe(Effect.provideService(Workspace, workspace), Effect.provide(testLayers(repo, {}))),
  )

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

const enter = async (repo: InMemRepo, workflow: string, ...vars: string[]): Promise<string> => {
  const flags = vars.flatMap((v) => ["--var", v])
  const { stdout, stderr, exitCode } = await cli(repo, "--workflow", workflow, ...flags)
  if (exitCode !== 0) throw new Error(`gtd --workflow exited ${exitCode}: ${stderr}`)
  return applied(repo, stdout)
}

/** Commits an exact message — for trailers no landing writes on its own. */
const commit = (repo: InMemRepo, spec: CommitSpec, files: Files = {}): string => {
  write(repo, files)
  repo.commitAllWithPrefix(formatCommitMessage(spec))
  return headOf(repo)
}

const LINEAR = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle", { message: "idle-message" })
  await agent("building", "build-prompt")
  await agent("checking", "check-prompt")
}

export const side = async () => {
  await agent("fixing", "fix-prompt")
  await agent("tidying", "tidy-prompt", { allowEmpty: true })
}

export const review = async () => {
  await agent("fixing", "fix-prompt")
}

export const defaults = { base: "", reviewer: "nobody" }

export const base = (workflow, vars) => (workflow === "review" ? (vars.base ?? "") : undefined)
`

describe("currentRun", () => {
  it("is empty at a non-gtd HEAD, which is both its start and its parent", async () => {
    const repo = repoWith(LINEAR)
    const boundary = headOf(repo)
    const run = await provide(currentRun, repo)
    expect(run).toMatchObject({
      workflow: undefined,
      startHash: boundary,
      startParentHash: boundary,
      diffBase: boundary,
      trace: [],
      costEntries: [],
      judgeVerdicts: [],
      pinnedVars: {},
      headTurn: undefined,
      closingHash: undefined,
      legacyOpening: false,
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

  it("a commit entering the default workflow's first step closes the episode", async () => {
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

  it("a step-less gtd(human): <step> commit opens a started workflow's episode as its first commit", async () => {
    const repo = repoWith(LINEAR)
    const before = headOf(repo)
    const opening = await enter(repo, "side")
    expect(repo.lastCommitMessage()).toBe(
      "gtd(human): fixing\n\nGtd-Workflow: side\nGtd-Var: base=\nGtd-Var: reviewer=nobody",
    )
    const fixed = await land(repo, { "fix.txt": "x\n" })
    const run = await provide(currentRun, repo)
    expect(run.workflow).toBe("side")
    expect(run.startHash).toBe(opening)
    expect(run.startParentHash).toBe(before)
    expect(run.trace).toEqual([
      { state: "fixing", hash: opening, actor: "human" },
      { state: "tidying", hash: fixed, actor: "agent" },
    ])
    expect(run.episode.base).toBe(opening)
    expect(run.episode.commits.map((c) => c.hash)).toEqual([fixed])
  })

  it("a workflow starting at the default's initial step still opens its own episode, not the empty tree", async () => {
    const STARTS_AT_INITIAL = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle", { message: "idle-message" })
  await agent("building", "build-prompt")
}

export const again = async () => {
  await human("idle", { message: "idle-message" })
  await agent("fixing", "fix-prompt")
  await agent("tidying", "tidy-prompt", { allowEmpty: true })
}
`
    const repo = repoWith(STARTS_AT_INITIAL)
    const before = headOf(repo)
    const opening = await enter(repo, "again")
    expect(repo.lastCommitMessage()).toBe("gtd(human): idle\n\nGtd-Workflow: again")
    const fixed = await land(repo, { "fix.txt": "x\n" })
    const run = await provide(currentRun, repo)
    expect(run.workflow).toBe("again")
    expect(run.startHash).toBe(opening)
    expect(run.startParentHash).toBe(before)
    expect(run.diffBase).toBe(before)
    expect(run.trace).toEqual([
      { state: "idle", hash: opening, actor: "human" },
      { state: "fixing", hash: fixed, actor: "human" },
    ])
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

  it("reads pinnedVars off a manual entry's opening commit", async () => {
    const repo = repoWith(LINEAR)
    await enter(repo, "side", "base=main", "reviewer=alice")
    await land(repo, { "fix.txt": "x\n" })
    const run = await provide(currentRun, repo)
    expect(run.pinnedVars).toEqual({ base: "main", reviewer: "alice" })
  })

  it("a default-entry episode pins the Gtd-Var trailers of its first commit", async () => {
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
    expect(run.pinnedVars).toEqual({ reviewer: "alice" })
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

describe("history reads stay bounded by the episode, not the repository", () => {
  /** Piles up `count` ordinary non-gtd commits before the workflow even exists — the repo's "age". */
  const repoWithHistory = (count: number): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile("seed.txt", "0")
    repo.commitAllWithPrefix("chore: seed 0")
    for (let i = 1; i < count; i++) {
      repo.writeFile("seed.txt", String(i))
      repo.commitAllWithPrefix(`chore: seed ${i}`)
    }
    write(repo, { "gtd.config.ts": LINEAR })
    repo.commitAllWithPrefix("chore: add workflow")
    return repo
  }

  it("currentRun never fetches a growing number of commit bodies as the repository ages", async () => {
    const repo = repoWithHistory(600)
    const boundary = headOf(repo)
    const building = await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    repo.bodyReadCount = 0
    const run = await provide(currentRun, repo)
    expect(run.startParentHash).toBe(boundary)
    expect(run.startHash).toBe(building)
    // Bounded by the episode (2 step commits) plus a small constant, never by
    // the 600 unrelated commits sitting underneath it.
    expect(repo.bodyReadCount).toBeLessThan(20)
  })

  it("summaryRun's closing read stays just as bounded", async () => {
    const repo = repoWithHistory(600)
    const boundary = headOf(repo)
    await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    const closing = await land(repo, { "c.txt": "c\n" })
    repo.bodyReadCount = 0
    const summary = await provide(summaryRun, repo)
    expect(summary.closingHash).toBe(closing)
    expect(summary.startParentHash).toBe(boundary)
    expect(repo.bodyReadCount).toBeLessThan(20)
  })

  it("an episode reaching the repository's root commit still resolves, with the empty tree as its base", async () => {
    const repo = new InMemRepo()
    write(repo, { "gtd.config.ts": LINEAR })
    const building = commit(
      repo,
      { actor: "human", to: "building", step: { name: "idle", occurrence: 1 } },
      { "a.txt": "a\n" },
    )
    const run = await provide(currentRun, repo)
    expect(run.startHash).toBe(building)
    expect(run.startParentHash).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904")
    expect(run.episode.base).toBeUndefined()
  })

  it("pins the body read to the hash the subject-only read resolved HEAD to, not a literal HEAD moved underneath it", async () => {
    const repo = repoWith(LINEAR)
    const boundary = headOf(repo)
    await land(repo, { "a.txt": "a\n" })
    const checking = await land(repo, { "b.txt": "b\n" })
    expect(headOf(repo)).toBe(checking)

    // Simulates a concurrent writer (a reset, another `gtd` on the same
    // checkout) moving literal HEAD back to the boundary commit in the
    // window between `historyUpTo`'s subject-only read and its body read.
    // `subjectHistory`'s first call observes and returns the CURRENT
    // (pre-move) history — exactly as a real `git log` would, already having
    // read it before the move happens — then the move fires.
    let moved = false
    const base = fakeGitOperations(repo)
    const raceyGit: GitOperations = {
      ...base,
      subjectHistory: (pageSize, skip, head) =>
        Effect.tap(base.subjectHistory(pageSize, skip, head), () => {
          if (!moved) {
            moved = true
            repo.hardResetTo(boundary)
          }
        }),
    }

    const run = await provideWithGit(currentRun, raceyGit, repo)

    // Pinned to the hash the subject-only read resolved HEAD to (`checking`):
    // the full episode, unaffected by the later move. An unpinned second read
    // would resolve literal HEAD to `boundary` instead, find no commits in
    // `base..boundary` (`boundary` is not a descendant of the computed
    // `base`), and silently fold to an empty run at the empty tree — exactly
    // what this test would catch.
    expect(run.startParentHash).toBe(boundary)
    expect(run.trace.map((t) => t.hash)).toHaveLength(2)
    expect(run.trace.at(-1)?.hash).toBe(checking)
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
    const repo = repoWith(`import { human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle", { file: "docs/adr.md", mode: "adr" })
}
`)
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
      'step "idle": mode "adr" is not a mode this workflow knows (qa, review)',
    )
  })

  it("refuses a step option the step does not accept, naming a retired one's replacement", async () => {
    const repo = repoWith(`import { agent } from "@pmelab/gtd/flows"

export default async () => {
  await agent("work", "p", { memory: "plan" })
}
`)
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
      'step "work": unknown key(s) memory in agent() options',
    )
  })
})

describe("reviewBaseFor", () => {
  const LOOP = `import { agent, head, human, read } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  while (read("DONE") === undefined) {
    const base = head()
    await human("checkpoint", { base })
    await agent("building", "build-prompt", { base })
  }
}

export const review = async () => {
  await agent("fixing", "fix-prompt")
}

export const defaults = { base: "" }

export const base = (workflow, vars) => (workflow === "review" ? (vars.base ?? "") : undefined)
`

  it("is the process's diff base at a step that names no base", async () => {
    const repo = repoWith(LOOP)
    const rest = await provide(currentRest, repo)
    expect(reviewBaseFor(rest)).toBe(rest.run.diffBase)
  })

  it("is the base the resting step names", async () => {
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

  it("falls back to an entry's Gtd-Review-Base at a step that names no base", async () => {
    const repo = repoWith(LOOP)
    const base = headOf(repo)
    repo.writeFile("later.txt", "later\n")
    repo.commitAllWithPrefix("feat: later")
    await enter(repo, "review", `base=${base}`)
    expect(reviewBaseFor(await provide(currentRest, repo))).toBe(base)
  })
})

describe("memory", () => {
  const SCOPED = `import { agent, human, read, scope } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  do await agent("build", "b")
  while (read("ROOT_DONE") === undefined)
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
}
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
    const repo = repoWith(`import { agent, human, scope } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await scope("child", () => agent("work", "c"))
  await agent("build", "b")
}
`)
    await land(repo, { "start.txt": "x\n" })
    await land(repo, { "child.txt": "x\n" })
    expect(await memoryAt(repo)).toMatchObject({ state: "build", resumed: false })
  })
})

describe("vars", () => {
  const VARS = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
}

export const side = async () => {
  await agent("working", "w")
}

export const defaults = { deployTarget: "npm test", reviewer: "nobody" }
`
  const seeded = () => repoWith(VARS, { ".gtdrc.yaml": "vars:\n  deployTarget: npm run rc\n" })

  it("a .gtdrc vars: entry overrides the workflow's default", async () => {
    const rest = await provide(currentRest, seeded())
    expect(rest.vars).toEqual({ deployTarget: "npm run rc", reviewer: "nobody" })
  })

  it("a started workflow's Gtd-Var overrides both the workflow default and .gtdrc", async () => {
    const repo = seeded()
    await enter(repo, "side", "deployTarget=npm run entry")
    const rest = await provide(currentRest, repo)
    expect(rest.vars.deployTarget).toBe("npm run entry")
  })

  it("GTD_<NAME> beats .gtdrc while nothing is pinned", async () => {
    const rest = await provide(currentRest, seeded(), { GTD_DEPLOYTARGET: "echo env-wins" })
    expect(rest.vars.deployTarget).toBe("echo env-wins")
  })

  it("a pinned value beats a GTD_<NAME> exported later, and .gtdrc edited later", async () => {
    const repo = seeded()
    await enter(repo, "side", "deployTarget=npm run entry")
    repo.writeFile(".gtdrc.yaml", "vars:\n  deployTarget: npm run edited\n")
    const rest = await provide(currentRest, repo, { GTD_DEPLOYTARGET: "echo env-late" })
    expect(rest.vars.deployTarget).toBe("npm run entry")
  })

  it("a started workflow pins every process setting, so a later default change is ignored", async () => {
    const repo = seeded()
    await enter(repo, "side")
    const run = await provide(currentRun, repo)
    expect(run.pinnedVars).toEqual({ reviewer: "nobody", deployTarget: "npm run rc" })
  })

  it("ignores a GTD_ env var naming no declared var", async () => {
    const rest = await provide(currentRest, seeded(), { GTD_BRANDNEW: "hello" })
    expect(Object.keys(rest.vars).sort()).toEqual(["deployTarget", "reviewer"])
  })
})

describe("environment settings", () => {
  const ENVV = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await agent("working", "w")
}

export const defaults = { floor: "0.7" }
export const envDefaults = { testCommand: "npm test" }
`
  const seeded = () => repoWith(ENVV, { ".gtdrc.yaml": "env:\n  testCommand: npm run rc\n" })

  it("resolve from envDefaults, .gtdrc env: and GTD_<NAME>, and never reach vars", async () => {
    const repo = seeded()
    expect((await provide(currentRest, repo)).env).toEqual({ testCommand: "npm run rc" })
    const rest = await provide(currentRest, repo, { GTD_TESTCOMMAND: "echo env" })
    expect(rest.env.testCommand).toBe("echo env")
    expect(rest.vars).toEqual({ floor: "0.7" })
  })

  it("are read live mid-process: an edited .gtdrc env: applies, and nothing is recorded", async () => {
    const repo = seeded()
    await land(repo, { "a.txt": "a\n" })
    repo.writeFile(".gtdrc.yaml", "env:\n  testCommand: npm run edited\n")
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("working")
    expect(rest.env.testCommand).toBe("npm run edited")
    expect((await provide(currentRun, repo)).pinnedVars).toEqual({ floor: "0.7" })
  })

  it("an ordinary start's first commit pins every process setting, sorted by name", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    expect(repo.lastCommitMessage()).toContain(
      "\n\nGtd-Step: idle#1\nGtd-Var: base=\nGtd-Var: reviewer=nobody",
    )
    await land(repo)
    expect((await provide(currentRun, repo)).pinnedVars).toEqual({ base: "", reviewer: "nobody" })
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

describe("judge rests", () => {
  const JUDGED = (budget: string) => `import { human, judge, read } from "@pmelab/gtd/flows"

export default async () => {
    await human("idle")
    await judge("verdict", {
      questions: [{ id: "q", primitive: "noul", instructions: "i", criteria: "c" }],
      evidence: { log: read("LOG.md") ?? "" },
      message: "judge-message",
    })
  }

export const defaults = { judgeBudgetBytes: ${JSON.stringify(budget)} }
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
    expect(rendered.judge).not.toContain("line 0 of the log")
  })

  it("leaves the message alone when nothing was cut", async () => {
    const { rendered } = await judgedAt("32768")
    expect(rendered.content).toBe("judge-message")
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
  const STEERED = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await agent("steered", "write-it", { file: ".gtd/AWAIT.md" })
}
`

  it("names the resting step's steering file and decides the landing", async () => {
    const repo = repoWith(STEERED)
    await land(repo, { "src/a.ts": "a\n" })
    repo.writeFile(".gtd/AWAIT.md", "pending content\n")
    const snapshot = await provide(snapshotFromRest(await provide(currentRest, repo)), repo)
    expect(snapshot.state).toBe("steered")
    expect(snapshot.file).toBe(".gtd/AWAIT.md")
    expect(snapshot.landing.kind).toBe("commit")
  })

  it("names no file at a step that declares none", async () => {
    const snapshot = await provide(
      snapshotFromRest(await provide(currentRest, repoWith(STEERED))),
      repoWith(STEERED),
    )
    expect(snapshot.file).toBeUndefined()
  })
})

describe("the pending working tree is read at most once per restAt, and never stale across a long-lived reuse", () => {
  const countingWorkspace = (
    repo: InMemRepo,
    root = "/repo",
  ): { readonly workspace: WorkspaceOps; readonly calls: () => number } => {
    const base = makeInMemoryWorkspaceOps(repo, root)
    let calls = 0
    return {
      workspace: {
        ...base,
        worktreeSync: () => {
          calls++
          return base.worktreeSync()
        },
      },
      calls: () => calls,
    }
  }

  it("decideLanding reads the working tree exactly once for one rest, even though it's the same ReplaySetup entryRefusal would also reuse", async () => {
    const repo = repoWith(LINEAR)
    write(repo, { "scratch.txt": "dirty\n" }) // a pending change forces the real replay path, not cleanLanding's early return
    const { workspace, calls } = countingWorkspace(repo)
    const rest = await provideWithWorkspace(currentRest, workspace, repo)
    expect(calls()).toBe(0) // restAt itself never touches the pending tree
    await provideWithWorkspace(snapshotFromRest(rest), workspace, repo)
    expect(calls()).toBe(1)
  })

  it("a SECOND restAt call sharing the same Workspace instance (an LSP's long-lived runtimeCache reuse) reads the working tree fresh, not a stale first-request snapshot", async () => {
    const repo = repoWith(LINEAR)
    write(repo, { "scratch.txt": "first\n" })
    const { workspace, calls } = countingWorkspace(repo)

    const rest1 = await provideWithWorkspace(currentRest, workspace, repo)
    const snap1 = await provideWithWorkspace(snapshotFromRest(rest1), workspace, repo)
    expect(snap1.changes.map((c) => c.path)).toContain("scratch.txt")

    // Between two "requests" against the same long-lived Workspace, the tree changes.
    write(repo, { "second.txt": "second\n" })

    const rest2 = await provideWithWorkspace(currentRest, workspace, repo)
    const snap2 = await provideWithWorkspace(snapshotFromRest(rest2), workspace, repo)
    expect(snap2.changes.map((c) => c.path)).toContain("second.txt")

    // One worktreeSync call per request, not one total — a workspace-scoped
    // memo (rather than the per-`ReplaySetup` one) would have kept `calls()`
    // at 1 and `snap2` stuck on the first request's tree.
    expect(calls()).toBe(2)
  })
})
