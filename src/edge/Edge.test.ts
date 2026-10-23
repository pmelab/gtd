import { Effect, Exit, Option } from "effect"
import { describe, expect, it } from "vitest"
import { runCli } from "../cli/index.js"
import {
  currentRest,
  currentRun,
  historyTrail,
  noProcessUnderway,
  renderRest,
  restAt,
  restIsIdle,
  reviewBaseFor,
  snapshotFromRest,
  stalledAt,
  summaryFor,
  summaryRun,
  TRUNCATION_NOTICE,
  UNATTRIBUTED_MODEL,
  type RestRequirements,
} from "./Edge.js"
import { GTD_VERSION } from "../install/index.js"
import { keptRef, processHistoryRef } from "../platform/index.js"
import { GitService, Workspace, type GitOperations, type WorkspaceOps } from "../platform/index.js"
import type { Mark } from "../flows/index.js"
import { formatCommitMessage, type CommitSpec } from "../replay/index.js"
import { contentHash, StartFlags } from "../workflow/index.js"
import {
  fakeGitOperations,
  InMemRepo,
  applyEmittedScript,
  makeCapturingCliIo,
  makeInMemoryWorkspaceOps,
  testLayers,
} from "../testkit/index.js"

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
  repo.seedCommit("chore: add workflow")
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
  repo.seedCommit(formatCommitMessage(spec))
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
      approvals: [],
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
    repo.seedCommit("feat: unrelated")
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
      `gtd(human): fixing\n\nGtd-Workflow: side\nGtd-Var: base=\nGtd-Var: reviewer=nobody\nGtd-Config: ${contentHash(LINEAR)} gtd.config.ts\nGtd-Format: 1`,
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
    expect(repo.lastCommitMessage()).toBe(
      `gtd(human): idle\n\nGtd-Workflow: again\nGtd-Config: ${contentHash(STARTS_AT_INITIAL)} gtd.config.ts\nGtd-Format: 1`,
    )
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
      { cost: 120, model: "opus", hash: run.trace[0]!.hash },
      { cost: 50, model: UNATTRIBUTED_MODEL, hash: run.trace[1]!.hash },
      { cost: 300, model: "haiku", hash: run.trace[2]!.hash },
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
    repo.seedCommit(
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
    repo.seedCommit("feat: later")
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

    it("describes an attempt: a step-less, empty commit", async () => {
      const repo = repoWith(LINEAR)
      await land(repo, { "a.txt": "a\n" })
      await land(repo)
      expect(repo.lastCommitMessage()).toBe("gtd(agent): building\n\nGtd-Format: 1")
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
    repo.seedCommit("chore: seed 0")
    for (let i = 1; i < count; i++) {
      repo.writeFile("seed.txt", String(i))
      repo.seedCommit(`chore: seed ${i}`)
    }
    write(repo, { "gtd.config.ts": LINEAR })
    repo.seedCommit("chore: add workflow")
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
    repo.seedCommit("chore: unrelated")
    const summary = await provide(summaryRun, repo)
    expect(summary.closingHash).toBeUndefined()
    expect(summary.trace).toEqual([])
  })
})

describe("process marks", () => {
  const SUMMARISED = `${LINEAR}
export const summary = (it) => it.marks.map((m) => m.name + "=" + m.value).join("|")
`
  const opening = (marks: readonly Mark[]): CommitSpec => ({
    actor: "human",
    from: "idle",
    to: "building",
    step: { name: "idle", occurrence: 1 },
    marks,
  })

  it("buildRun collects marks from the process's commits only, oldest first", async () => {
    const repo = repoWith(SUMMARISED)
    commit(
      repo,
      {
        actor: "agent",
        from: "checking",
        to: "idle",
        marks: [{ name: "risk-tier", value: "high" }],
      },
      { "old.txt": "o\n" },
    )
    commit(
      repo,
      opening([
        { name: "production-signal", value: "one" },
        { name: "production-signal", value: "two" },
      ]),
      { "a.txt": "a\n" },
    )
    commit(
      repo,
      {
        actor: "agent",
        from: "building",
        to: "checking",
        step: { name: "building", occurrence: 1 },
        marks: [{ name: "production-signal", value: "three" }],
      },
      { "b.txt": "b\n" },
    )
    const run = await provide(currentRun, repo)
    expect(run.marks).toEqual([
      { name: "production-signal", value: "one" },
      { name: "production-signal", value: "two" },
      { name: "production-signal", value: "three" },
    ])
  })

  it("is empty for a process whose commits carry no marks", async () => {
    const repo = repoWith(SUMMARISED)
    await land(repo, { "a.txt": "a\n" })
    expect((await provide(currentRun, repo)).marks).toEqual([])
  })
})

const withTipMessage = (repo: InMemRepo, edit: (message: string) => string): GitOperations => {
  const real = fakeGitOperations(repo)
  const head = repo.resolveRef("HEAD")
  return {
    ...real,
    commitHistory: (base, tip) =>
      Effect.map(real.commitHistory(base, tip), (commits) =>
        commits.map((c) => (c.hash === head ? { ...c, message: edit(c.message) } : c)),
      ),
  }
}

describe("summaryFor", () => {
  const SUMMARISED_FLOW = `import { agent, human, mark } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle", { message: "idle-message" })
  mark("risk-tier", "high")
  await agent("building", "build-prompt")
  await human("gate", { message: "gate-message" })
  await agent("checking", "check-prompt")
}

export const summary = (it) => JSON.stringify(it)
`
  const landCost = async (repo: InMemRepo, files: Files, cost: number, model: string) => {
    write(repo, files)
    const { stdout, stderr, exitCode } = await cli(
      repo,
      "land",
      "--json",
      `--cost=${cost}`,
      `--model=${model}`,
    )
    if (exitCode !== 0) throw new Error(`gtd land exited ${exitCode}: ${stderr}${stdout}`)
    return applied(repo, (JSON.parse(stdout) as { readonly script: string }).script)
  }
  type Rendered = {
    entryCommit: string
    processBase: string
    processTip: string
    humanCommits: { hash: string; state: string }[]
    processCost: number
    processCostByModel: { model: string; cost: number }[]
    marks: Mark[]
  }

  /** Entry (human, idle→building), build agent, human gate, check agent closing. */
  const finished = async () => {
    const repo = repoWith(SUMMARISED_FLOW)
    const boundary = headOf(repo)
    const entry = await landCost(repo, { "NOTE.md": "n\n" }, 1, "opus")
    await landCost(repo, { "a.txt": "a\n" }, 10, "opus")
    const gate = await landCost(repo, { "b.txt": "b\n" }, 100, "haiku")
    const closing = await landCost(repo, { "c.txt": "c\n" }, 1000, "haiku")
    return { repo, boundary, entry, gate, closing }
  }
  const render = async (repo: InMemRepo) => {
    const run = await provide(summaryRun, repo)
    const { prompt } = await provide(summaryFor(run), repo)
    return JSON.parse(prompt!) as Rendered
  }

  it("renders the whole process: its range, human commits, cost and marks", async () => {
    const { repo, boundary, entry, gate, closing } = await finished()
    const whole = await render(repo)
    expect(whole.entryCommit).toBe(entry)
    expect([whole.processBase, whole.processTip]).toEqual([boundary, closing])
    expect(whole.humanCommits.map((c) => c.hash)).toEqual([gate])
    expect(whole.processCost).toBe(1111)
    expect(whole.marks.length).toBeGreaterThan(0)
  })

  it("has nothing to render on an empty trace", async () => {
    const repo = repoWith(SUMMARISED_FLOW)
    const run = await provide(summaryRun, repo)
    expect(await provide(summaryFor(run), repo)).toEqual({ prompt: undefined })
  })

  it("returns no prompt, not a failure, when an edited config no longer exports a summary", async () => {
    const { repo } = await finished()
    const run = await provide(summaryRun, repo)
    repo.writeFile("gtd.config.ts", SUMMARISED_FLOW.replace(/export const summary.*\n/, ""))
    expect(await provide(summaryFor(run), repo)).toEqual({ prompt: undefined })
  })

  it("still returns a prompt under a config edited since the close, never replaying", async () => {
    const { repo } = await finished()
    const run = await provide(summaryRun, repo)
    repo.writeFile("gtd.config.ts", `${SUMMARISED_FLOW}\n// edited\n`)
    expect((await provide(summaryFor(run), repo)).prompt).toBeDefined()
  })
})

describe("restAt", () => {
  it("totals recorded cost and breaks it down by model, highest first", async () => {
    const repo = repoWith(LINEAR)
    for (const [file, cost, model] of [
      ["a.txt", 1, "opus"],
      ["b.txt", 10, "haiku"],
    ] as const) {
      write(repo, { [file]: "x\n" })
      const { stdout, exitCode } = await cli(
        repo,
        "land",
        "--json",
        `--cost=${cost}`,
        `--model=${model}`,
      )
      expect(exitCode).toBe(0)
      await applied(repo, (JSON.parse(stdout) as { readonly script: string }).script)
    }
    const { cost } = await provide(currentRest, repo)
    expect(cost.total).toBe(11)
    expect(cost.byModel).toEqual([
      { model: "haiku", cost: 10 },
      { model: "opus", cost: 1 },
    ])
  })

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
      'step "idle": mode "adr" is not a mode this workflow knows (qa, review, findings)',
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
    repo.seedCommit("feat: later")
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
  const seeded = () => repoWith(VARS)

  it("resolve from the workflow's defaults", async () => {
    const rest = await provide(currentRest, seeded())
    expect(rest.vars).toEqual({ deployTarget: "npm test", reviewer: "nobody" })
  })

  it("a started workflow's Gtd-Var overrides the workflow default", async () => {
    const repo = seeded()
    await enter(repo, "side", "deployTarget=npm run entry")
    const rest = await provide(currentRest, repo)
    expect(rest.vars.deployTarget).toBe("npm run entry")
  })

  it("GTD_<NAME> beats the default while nothing is pinned", async () => {
    const rest = await provide(currentRest, seeded(), { GTD_DEPLOYTARGET: "echo env-wins" })
    expect(rest.vars.deployTarget).toBe("echo env-wins")
  })

  it("a pinned value beats a GTD_<NAME> exported later, and a default edited later", async () => {
    const repo = seeded()
    await enter(repo, "side", "deployTarget=npm run entry")
    repo.writeFile("gtd.config.ts", VARS.replace('"npm test"', '"npm run edited"'))
    const rest = await provide(currentRest, repo, { GTD_DEPLOYTARGET: "echo env-late" })
    expect(rest.vars.deployTarget).toBe("npm run entry")
  })

  it("a started workflow pins every process setting, so a later default change is ignored", async () => {
    const repo = seeded()
    await enter(repo, "side")
    repo.writeFile("gtd.config.ts", VARS.replace('"nobody"', '"somebody"'))
    const run = await provide(currentRun, repo)
    expect(run.pinnedVars).toEqual({ reviewer: "nobody", deployTarget: "npm test" })
  })

  it("ignores a GTD_ env var naming no declared var", async () => {
    const rest = await provide(currentRest, seeded(), { GTD_BRANDNEW: "hello" })
    expect(Object.keys(rest.vars).sort()).toEqual(["deployTarget", "reviewer"])
  })
})

describe("StartFlags", () => {
  const FLAGGED = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
}

export const side = async () => {
  await agent("working", "w")
}

export const defaults = { flag_risk_tier: "0", other: "x" }
`
  const withFlags = <A>(
    eff: Effect.Effect<A, Error, RestRequirements>,
    repo: InMemRepo,
    flags: Record<string, string>,
  ): Promise<A> =>
    Effect.runPromise(
      eff.pipe(Effect.provideService(StartFlags, flags), Effect.provide(testLayers(repo, {}))),
    )

  it("a starting process takes the declared flag from StartFlags, never an undeclared one", async () => {
    const rest = await withFlags(currentRest, repoWith(FLAGGED), {
      flag_risk_tier: "1",
      flag_other: "1",
    })
    expect(rest.vars).toEqual({ flag_risk_tier: "1", other: "x" })
  })

  it("a running process missing the pin resolves the declared default, never the live flag", async () => {
    const repo = repoWith(FLAGGED.replace('flag_risk_tier: "0", ', ""))
    await enter(repo, "side")
    // a process started before the flag existed: its opening commit lacks the pin
    repo.writeFile("gtd.config.ts", FLAGGED)
    const rest = await withFlags(currentRest, repo, { flag_risk_tier: "1" })
    expect(rest.vars.flag_risk_tier).toBe("0")
  })

  it("with no StartFlags provided, resolves the declared default", async () => {
    expect((await provide(currentRest, repoWith(FLAGGED))).vars.flag_risk_tier).toBe("0")
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
  const seeded = () => repoWith(ENVV)

  it("resolve from envDefaults and GTD_<NAME>, and never reach vars", async () => {
    const repo = seeded()
    expect((await provide(currentRest, repo)).env).toEqual({ testCommand: "npm test" })
    const rest = await provide(currentRest, repo, { GTD_TESTCOMMAND: "echo env" })
    expect(rest.env.testCommand).toBe("echo env")
    expect(rest.vars).toEqual({ floor: "0.7" })
  })

  it("are read live mid-process: an edited envDefaults applies, and nothing is recorded", async () => {
    const repo = seeded()
    await land(repo, { "a.txt": "a\n" })
    repo.writeFile("gtd.config.ts", ENVV.replace('"npm test"', '"npm run edited"'))
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
    repo.seedCommit("gtd(agent): tidying")
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

describe("finishing landings keep history", () => {
  const landingOf = async (repo: InMemRepo, git?: GitOperations) => {
    const rest = await provide(currentRest, repo)
    const eff = snapshotFromRest(rest)
    const snapshot = await (git === undefined ? provide(eff, repo) : provideWithGit(eff, git, repo))
    const landing = snapshot.landing
    if (landing.kind !== "commit") throw new Error(`expected commit, got ${landing.kind}`)
    return landing
  }

  it("flow return: keeps refs/gtd/history/<startHash>, records version and branch", async () => {
    const repo = repoWith(LINEAR)
    const building = await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    repo.writeFile("c.txt", "c\n")
    const landing = await landingOf(repo)
    expect(landing.to).toBe("idle")
    expect(landing.keepHistory).toBe(processHistoryRef(building))
    expect(landing.spec.version).toBe(GTD_VERSION)
    expect(landing.spec.branch).toBe(repo.branchName())
  })

  it("restart() is a finish too", async () => {
    const repo = repoWith(`import { agent, human, restart } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await agent("building", "build-prompt")
  await restart()
}
`)
    const building = await land(repo, { "a.txt": "a\n" })
    repo.writeFile("b.txt", "b\n")
    const landing = await landingOf(repo)
    expect(landing.to).toBe("idle")
    expect(landing.keepHistory).toBe(processHistoryRef(building))
  })

  it("starting landings and mid-process landings carry no keepHistory and no new trailers", async () => {
    const repo = repoWith(LINEAR)
    repo.writeFile("a.txt", "a\n")
    const starting = await landingOf(repo)
    expect(starting.to).toBe("building")
    expect(starting.keepHistory).toBeUndefined()
    expect(starting.spec.version).toBeUndefined()
    expect(starting.spec.branch).toBeUndefined()
    await land(repo, { "a.txt": "a\n" })
    repo.writeFile("b.txt", "b\n")
    const mid = await landingOf(repo)
    expect(mid.to).toBe("checking")
    expect(mid.keepHistory).toBeUndefined()
    expect(mid.spec.version).toBeUndefined()
    expect(mid.spec.branch).toBeUndefined()
  })

  it("detached HEAD keeps history but records no branch", async () => {
    const repo = repoWith(LINEAR)
    const building = await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    repo.writeFile("c.txt", "c\n")
    const detached: GitOperations = {
      ...fakeGitOperations(repo),
      currentBranch: () => Effect.succeed(Option.none()),
    }
    const landing = await landingOf(repo, detached)
    expect(landing.keepHistory).toBe(processHistoryRef(building))
    expect(landing.spec.version).toBe(GTD_VERSION)
    expect(landing.spec.branch).toBeUndefined()
  })

  it("a --workflow process's entry is its opening commit", async () => {
    const repo = repoWith(`import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await agent("building", "build-prompt")
}

export const side = async () => {
  await agent("fixing", "fix-prompt")
}
`)
    const opening = await enter(repo, "side")
    repo.writeFile("a.txt", "a\n")
    const landing = await landingOf(repo)
    expect(landing.to).toBe("idle")
    expect(landing.keepHistory).toBe(processHistoryRef(opening))
  })

  it("the landing script overwrites an existing ref with its own commit", async () => {
    const repo = repoWith(LINEAR)
    const building = await land(repo, { "a.txt": "a\n" })
    await land(repo, { "b.txt": "b\n" })
    const ref = processHistoryRef(building)
    repo.updateRef(ref, building)
    const tip = await land(repo, { "c.txt": "c\n" })
    expect(repo.resolveRef(ref)).toBe(tip)
  })
})

describe("keep steps", () => {
  const KEEP = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await agent("building", "build-prompt", { keep: true })
  await agent("checking", "check-prompt")
}
`

  const snapshotOf = async (repo: InMemRepo) =>
    (await provide(snapshotFromRest(await provide(currentRest, repo)), repo)).landing

  it("landing at a keep step carries keepTurn under refs/gtd/kept/<startHash>/<step>", async () => {
    const repo = repoWith(KEEP)
    const building = await land(repo, { "a.txt": "a\n" })
    repo.writeFile("naive.txt", "naive\n")
    const landing = await snapshotOf(repo)
    if (landing.kind !== "commit") throw new Error(`expected commit, got ${landing.kind}`)
    expect(landing.to).toBe("checking")
    expect(landing.keepTurn).toBe(keptRef(building, "building"))
    expect(landing.keepTurn).toBe(`refs/gtd/kept/${building}/building`)
  })

  it("a landing at a step that does not keep carries no keepTurn", async () => {
    const repo = repoWith(KEEP)
    repo.writeFile("a.txt", "a\n")
    const landing = await snapshotOf(repo)
    if (landing.kind !== "commit") throw new Error(`expected commit, got ${landing.kind}`)
    expect(landing.keepTurn).toBeUndefined()
  })

  it("a clean tree at a keep step is still an attempt, never a keep", async () => {
    const repo = repoWith(KEEP)
    await land(repo, { "a.txt": "a\n" })
    const landing = await snapshotOf(repo)
    expect(landing.kind).toBe("attempt")
  })

  it("a marker at HEAD is not a stall: the process rests at the step after the keep", async () => {
    const repo = repoWith(KEEP)
    await land(repo, { "a.txt": "a\n" })
    await land(repo, { "naive.txt": "naive\n" })
    expect(repo.readFile("naive.txt")).toBeUndefined()
    expect(repo.lastCommitMessage()).toMatch(/\nGtd-Kept: [0-9a-f]{40}$/)
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("checking")
    expect(stalledAt(rest)).toBe(false)
  })
})

describe("kept episode commits", () => {
  const KEEP = `import { agent, human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await agent("building", "build-prompt", { keep: true })
  await agent("checking", "check-prompt")
}
`

  const keptRepo = async () => {
    const repo = repoWith(KEEP)
    await land(repo, { "a.txt": "a\n" })
    await land(repo, { "naive.txt": "naive\n" })
    return repo
  }

  it("builds kept: { hash, tree } for a marker whose kept object exists", async () => {
    const repo = await keptRepo()
    const rest = await provide(currentRest, repo)
    const marker = rest.setup.episode.at(-1)!
    const hash = /Gtd-Kept: ([0-9a-f]{40})/.exec(repo.lastCommitMessage()!)![1]!
    expect(marker.kept?.hash).toBe(hash)
    expect(marker.kept?.tree.read("naive.txt")).toBe("naive\n")
    expect(marker.tree.read("naive.txt")).toBeUndefined()
  })

  it("builds no kept for a marker whose kept object is missing", async () => {
    const repo = await keptRepo()
    const message = repo
      .lastCommitMessage()!
      .replace(/Gtd-Kept: [0-9a-f]{40}/, `Gtd-Kept: ${"ab".repeat(20)}`)
    repo.hardResetTo("HEAD~1")
    repo.commitAsIs(message)
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("checking")
    expect(rest.setup.episode.at(-1)!.kept).toBeUndefined()
  })

  it("builds no kept for a commit without the trailer", async () => {
    const repo = await keptRepo()
    const rest = await provide(currentRest, repo)
    expect(rest.setup.episode.slice(0, -1).every((c) => c.kept === undefined)).toBe(true)
  })
})

describe("historyTrail", () => {
  const finished = async (config = LINEAR) => {
    const repo = repoWith(config)
    const building = await land(repo, { "a.txt": "a\n" })
    const checking = await land(repo, { "b.txt": "b\n" })
    const tip = await land(repo, { "c.txt": "c\n" })
    return { repo, building, checking, tip }
  }

  it("replays every commit of the closed run, with HEAD elsewhere", async () => {
    const { repo, building, checking, tip } = await finished()
    repo.writeFile("d.txt", "d\n")
    repo.seedCommit("chore: unrelated")
    const trail = await provide(historyTrail(tip), repo)
    expect(trail.tip).toBe(tip)
    expect(trail.ended).toBe("return")
    expect(trail.steps.map((s) => s.hash)).toEqual([building, checking, tip])
    expect(trail.steps[2]).toMatchObject({
      subject: "gtd(agent): checking → idle",
      actor: "agent",
      from: "checking",
      to: "idle",
      verdicts: [],
    })
    expect(trail.steps[0]).toMatchObject({ actor: "human", to: "building" })
  })

  it("a restart() ends the trail as restart", async () => {
    const repo = repoWith(`import { agent, human, restart } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await agent("building", "build-prompt")
  await restart()
}
`)
    await land(repo, { "a.txt": "a\n" })
    const tip = await land(repo, { "b.txt": "b\n" })
    expect((await provide(historyTrail(tip), repo)).ended).toBe("restart")
  })

  it("carries each judge verdict on the commit that recorded it", async () => {
    const repo = repoWith(LINEAR)
    await land(repo, { "a.txt": "a\n" })
    const verdictCommit = commit(
      repo,
      {
        actor: "agent",
        from: "building",
        to: "checking",
        step: { name: "building", occurrence: 1 },
        judge: [{ id: "q", answer: "yes", p: 0.9 }],
      },
      { "b.txt": "b\n" },
    )
    const tip = await land(repo, { "c.txt": "c\n" })
    const trail = await provide(historyTrail(tip), repo)
    expect(trail.steps.find((s) => s.hash === verdictCommit)?.verdicts).toEqual([
      { id: "q", answer: "yes", p: 0.9 },
    ])
    expect(trail.steps.filter((s) => s.verdicts.length > 0)).toHaveLength(1)
  })

  it("sets approval on the approval step only", async () => {
    const repo = repoWith(`import { human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await human("gate", { message: "seam report", approve: true })
  await human("after")
}
`)
    await land(repo, { "src/a.ts": "a\n" })
    const approval = await land(repo)
    const tip = await land(repo, { "src/b.ts": "b\n" })
    const trail = await provide(historyTrail(tip), repo)
    expect(trail.steps.find((s) => s.hash === approval)?.approval).toEqual({
      step: "gate#1",
      name: "Test",
      email: "test@test.com",
      commit: approval,
    })
    expect(trail.steps.filter((s) => s.approval !== undefined)).toHaveLength(1)
  })

  it("records the version and warns about none while they match", async () => {
    const { repo, tip } = await finished()
    const trail = await provide(historyTrail(tip), repo)
    expect(trail.version).toEqual({ recorded: GTD_VERSION, running: GTD_VERSION })
    expect(trail.versionWarning).toBeUndefined()
  })

  it("warns, never refuses, when the recorded version differs", async () => {
    const { repo, tip } = await finished()
    const git = withTipMessage(repo, (m) =>
      m.replace(`Gtd-Version: ${GTD_VERSION}`, "Gtd-Version: 0.0.1"),
    )
    const trail = await Effect.runPromise(
      historyTrail(tip).pipe(
        Effect.provideService(GitService, git),
        Effect.provide(testLayers(repo, {})),
      ),
    )
    expect(trail.version.recorded).toBe("0.0.1")
    expect(trail.versionWarning).toContain("0.0.1")
    expect(trail.versionWarning).toContain(GTD_VERSION)
  })

  it("a missing recorded version counts as different", async () => {
    const { repo, tip } = await finished()
    const git = withTipMessage(repo, (m) => m.replace(/Gtd-Version: .*\n?/, ""))
    const trail = await Effect.runPromise(
      historyTrail(tip).pipe(
        Effect.provideService(GitService, git),
        Effect.provide(testLayers(repo, {})),
      ),
    )
    expect(trail.version.recorded).toBeUndefined()
    expect(trail.versionWarning).toContain(GTD_VERSION)
  })

  it("reads a recorded version carrying control bytes as unknown", async () => {
    const { repo, tip } = await finished()
    const raw = "1.0\u001b]0;x\u0007"
    const git = withTipMessage(repo, (m) =>
      m.replace(`Gtd-Version: ${GTD_VERSION}`, `Gtd-Version: ${raw}`),
    )
    const trail = await Effect.runPromise(
      historyTrail(tip).pipe(
        Effect.provideService(GitService, git),
        Effect.provide(testLayers(repo, {})),
      ),
    )
    expect(trail.version.recorded).toBeUndefined()
    expect(trail.versionWarning).toContain("an unknown gtd version")
    // eslint-disable-next-line no-control-regex
    expect(trail.versionWarning).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
  })

  it("refuses naming the config file that differs at the tip", async () => {
    const { repo, tip } = await finished()
    repo.writeFile("gtd.config.ts", `${LINEAR}\n// edited\n`)
    repo.seedCommit("chore: edit config")
    const exit = await provideExit(historyTrail(tip), repo)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain(
      `gtd history: refused — config differs at ${tip.slice(0, 7)}: gtd.config.ts. A history ref replays under today's config, so it is unreadable after the config changes`,
    )
  })

  it("refuses a resting tip with the exact message", async () => {
    const repo = repoWith(LINEAR)
    const tip = await land(repo, { "a.txt": "a\n" })
    const exit = await provideExit(historyTrail(tip), repo)
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain(
      `gtd history: ${tip.slice(0, 7)} does not close a process under today's config`,
    )
  })

  it("reads the episode's trees exactly once", async () => {
    const { repo, tip } = await finished()
    let calls = 0
    const trail = await Effect.runPromise(
      Effect.gen(function* () {
        const real = yield* Workspace
        return yield* historyTrail(tip).pipe(
          Effect.provideService(Workspace, {
            ...real,
            episodeTrees: (...args: Parameters<typeof real.episodeTrees>) => {
              calls++
              return real.episodeTrees(...args)
            },
          }),
        )
      }).pipe(Effect.provide(testLayers(repo, {}))),
    )
    expect(trail.steps).toHaveLength(3)
    expect(calls).toBe(1)
  })

  it("refuses naming a config file missing from the tip", async () => {
    const { repo, tip } = await finished()
    repo.writeFile("gtd.config.ts", `import "./extra.ts"\n${LINEAR}`)
    repo.writeFile("extra.ts", "export {}\n")
    repo.seedCommit("chore: split config")
    const exit = await provideExit(historyTrail(tip), repo)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain("gtd.config.ts")
  })
})

describe("landing at an approve rest", () => {
  const GATED = `import { human } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle")
  await human("gate", { message: "seam report", approve: true })
  await human("after")
}
`

  const atGate = async (): Promise<InMemRepo> => {
    const repo = repoWith(GATED)
    await land(repo, { "src/a.ts": "a\n" })
    return repo
  }

  const snapshotAt = async (repo: InMemRepo, git?: GitOperations) => {
    const rest = await provide(currentRest, repo)
    const effect = snapshotFromRest(rest)
    return git === undefined ? await provide(effect, repo) : await provideWithGit(effect, git, repo)
  }

  it("rests at a message step carrying approve", async () => {
    const rest = await provide(currentRest, await atGate())
    expect(rest.state).toBe("gate")
    expect(rest.stepDef).toMatchObject({ kind: "message", content: "seam report", approve: true })
  })

  it("refuses a dirty tree and commits nothing", async () => {
    const repo = await atGate()
    const head = headOf(repo)
    repo.writeFile("src/edited.ts", "edit\n")
    const { landing } = await snapshotAt(repo)
    expect(landing).toEqual({
      kind: "refusal",
      message:
        "gtd land: approval-gate: gate#1 approves exactly the judged diff — revert your edits and run `gtd land` on a clean tree to approve, or run `gtd abandon`",
    })
    expect(headOf(repo)).toBe(head)
  })

  const stageThenRevert = (repo: InMemRepo): void => {
    repo.writeFile("src/a.ts", "edited\n")
    repo.stageAll()
    repo.writeFile("src/a.ts", "a\n")
  }

  it("refuses an edit staged and then reverted in the worktree", async () => {
    const repo = await atGate()
    stageThenRevert(repo)
    expect((await snapshotAt(repo)).landing).toMatchObject({
      kind: "refusal",
      message: expect.stringContaining("approves exactly the judged diff"),
    })
  })

  it("counts no index-only edit at a rest that approves nothing", async () => {
    const repo = await atGate()
    await land(repo)
    stageThenRevert(repo)
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("after")
    expect(rest.changes).toEqual([])
    expect((await snapshotAt(repo)).landing).toEqual({ kind: "noop", settled: false })
  })

  it("refuses a clean tree when git has no author identity", async () => {
    const repo = await atGate()
    const git = { ...fakeGitOperations(repo), authorIdent: () => Effect.succeed(Option.none()) }
    const { landing } = await snapshotAt(repo, git)
    expect(landing).toEqual({
      kind: "refusal",
      message:
        "gtd land: approval-gate: gate#1 records who approved it, but git has no author identity — set user.name and user.email",
    })
  })

  it("refuses an identity a trailer cannot carry", async () => {
    const repo = await atGate()
    const git = {
      ...fakeGitOperations(repo),
      authorIdent: () => Effect.succeed(Option.some({ name: "Ada\u001b[31m", email: "a@x.io" })),
    }
    expect((await snapshotAt(repo, git)).landing).toEqual({
      kind: "refusal",
      message:
        "gtd land: approval-gate: gate#1 cannot record Ada\u001b[31m <a@x.io> as approver — it would not read back unchanged from its Gtd-Approved trailer (a control character, for example)",
    })
  })

  it("approve implies acceptClean even when acceptClean is false", async () => {
    const repo = repoWith(GATED.replace("approve: true", "approve: true, acceptClean: false"))
    await land(repo, { "src/a.ts": "a\n" })
    expect((await snapshotAt(repo)).landing.kind).toBe("commit")
  })

  it("lands a clean tree as a commit carrying the approver", async () => {
    const repo = await atGate()
    const { landing } = await snapshotAt(repo)
    if (landing.kind !== "commit") throw new Error(`expected commit, got ${landing.kind}`)
    expect(landing.to).toBe("after")
    expect(landing.spec.approved).toEqual({
      step: { name: "gate", occurrence: 1 },
      name: "Test",
      email: "test@test.com",
    })
  })

  it("reads the author identity only at an approve rest", async () => {
    const repo = repoWith(GATED)
    repo.writeFile("src/a.ts", "a\n")
    const git = {
      ...fakeGitOperations(repo),
      authorIdent: () => Effect.die(new Error("authorIdent read at a plain rest")),
    }
    expect((await snapshotAt(repo, git)).landing.kind).toBe("commit")
  })

  it("collects each approval of the current process, oldest first", async () => {
    const repo = await atGate()
    expect((await provide(currentRun, repo)).approvals).toEqual([])
    const approval = await land(repo)
    expect((await provide(currentRun, repo)).approvals).toEqual([
      { step: "gate#1", name: "Test", email: "test@test.com", commit: approval },
    ])
  })

  it("resumes past the approval commit without asking again", async () => {
    const repo = await atGate()
    await land(repo)
    expect(repo.lastCommitMessage()).toContain(
      'Gtd-Approved: {"step":"gate#1","name":"Test","email":"test@test.com"}',
    )
    expect((await provide(currentRest, repo)).state).toBe("after")
  })
})

describe("marks on a landing", () => {
  const MARKING = `import { agent, human, mark } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle", { message: "idle-message" })
  mark("risk-tier", "high")
  mark("production-signal", "error rate")
  await agent("building", "build-prompt")
  await agent("checking", "check-prompt")
}
`

  const landingOf = async (repo: InMemRepo) => {
    const rest = await provide(currentRest, repo)
    const snapshot = await provide(snapshotFromRest(rest), repo)
    const landing = snapshot.landing
    if (landing.kind !== "commit") throw new Error(`expected commit, got ${landing.kind}`)
    return landing
  }

  it("writes the outcome's marks, in order, into the landing's commit spec", async () => {
    const repo = repoWith(MARKING)
    repo.writeFile("TODO.md", "go\n")
    const landing = await landingOf(repo)
    expect(landing.spec.marks).toEqual([
      { name: "risk-tier", value: "high" },
      { name: "production-signal", value: "error rate" },
    ])
  })

  it("writes the marks of a flow that ends right after marking", async () => {
    const repo = repoWith(`import { human, mark } from "@pmelab/gtd/flows"

export default async () => {
  await human("idle", { message: "idle-message" })
  mark("done", "yes")
}
`)
    repo.writeFile("TODO.md", "go\n")
    const landing = await landingOf(repo)
    expect(landing.spec.marks).toEqual([{ name: "done", value: "yes" }])
  })

  it("leaves marks off a landing the flow marked nothing on", async () => {
    const repo = repoWith(MARKING)
    await land(repo, { "TODO.md": "go\n" })
    repo.writeFile("a.txt", "a\n")
    const landing = await landingOf(repo)
    expect(landing.spec.marks).toBeUndefined()
  })
})
