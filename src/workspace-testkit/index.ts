import { isAdapterFailure, type Worktree, type WorktreesAdapter } from "../workspace/index.js"

/**
 * One contract case. It runs under any test runner: `run` rejects when the
 * adapter breaks the contract.
 *
 *     for (const c of worktreesContract(harness)) test(c.name, c.run)
 */
export interface ContractCase {
  readonly name: string
  readonly run: () => Promise<void>
}

/**
 * A fresh world for one case: one project whose default branch has a commit,
 * with the adapter under test looking at it. The seeding operations change
 * that world the way a person with git would.
 */
export interface WorktreesFixture {
  readonly adapter: WorktreesAdapter
  /** The id the adapter reports for the project. */
  readonly project: string
  readonly defaultBranch: string
  /** A new worktree on a new branch, made from the default branch's tip. */
  readonly addWorktree: (branch: string) => Promise<void>
  /** One new commit on the branch. */
  readonly commit: (branch: string) => Promise<void>
  /** The branch merged into the default branch: squashed into one new commit, or with a merge commit. */
  readonly merge: (branch: string, how: "squash" | "merge") => Promise<void>
  readonly dispose: () => Promise<void>
}

export interface WorktreesHarness {
  readonly setup: () => Promise<WorktreesFixture>
}

const fail = (message: string): never => {
  throw new Error(message)
}

const withFixture =
  (harness: WorktreesHarness, body: (fixture: WorktreesFixture) => Promise<void>) =>
  async (): Promise<void> => {
    const fixture = await harness.setup()
    try {
      await body(fixture)
    } finally {
      await fixture.dispose()
    }
  }

const worktreeOf = async (fixture: WorktreesFixture, branch: string): Promise<Worktree> => {
  const worktrees = await fixture.adapter.list(fixture.project)
  return (
    worktrees.find((w) => w.branch === branch) ??
    fail(`list(${JSON.stringify(fixture.project)}) has no worktree on branch "${branch}"`)
  )
}

const integratedIs = async (
  fixture: WorktreesFixture,
  branch: string,
  expected: boolean,
): Promise<void> => {
  const { integrated } = await worktreeOf(fixture, branch)
  if (integrated !== expected) {
    fail(`branch "${branch}": integrated is ${String(integrated)}, expected ${String(expected)}`)
  }
}

/** The cases every worktrees adapter passes, bundled or userland. */
export const worktreesContract = (harness: WorktreesHarness): readonly ContractCase[] => [
  {
    name: "projects() reports the project",
    run: withFixture(harness, async (fixture) => {
      const ids = (await fixture.adapter.projects()).map((p) => p.id)
      if (!ids.includes(fixture.project)) {
        fail(`projects() reported ${JSON.stringify(ids)}, not "${fixture.project}"`)
      }
    }),
  },
  {
    name: "list() reports the main checkout on the default branch, with its full HEAD commit",
    run: withFixture(harness, async (fixture) => {
      const main = await worktreeOf(fixture, fixture.defaultBranch)
      if (!main.main) fail("the default branch's checkout is not reported as main")
      if (!/^[0-9a-f]{40}$/.test(main.head))
        fail(`head ${JSON.stringify(main.head)} is not a full commit`)
      if (main.integrated !== false) fail("the main checkout is reported as integrated")
    }),
  },
  {
    name: "a fresh worktree is not integrated: it has no commits of its own",
    run: withFixture(harness, async (fixture) => {
      await fixture.addWorktree("fresh")
      const fresh = await worktreeOf(fixture, "fresh")
      if (fresh.main) fail("a linked worktree is reported as main")
      await integratedIs(fixture, "fresh", false)
    }),
  },
  {
    name: "a worktree with commits not on the default branch is not integrated",
    run: withFixture(harness, async (fixture) => {
      await fixture.addWorktree("ahead")
      await fixture.commit("ahead")
      await integratedIs(fixture, "ahead", false)
    }),
  },
  {
    name: "a squash-merged worktree is integrated",
    run: withFixture(harness, async (fixture) => {
      await fixture.addWorktree("squashed")
      await fixture.commit("squashed")
      await fixture.commit("squashed")
      await fixture.merge("squashed", "squash")
      await integratedIs(fixture, "squashed", true)
    }),
  },
  {
    name: "a merged worktree is integrated",
    run: withFixture(harness, async (fixture) => {
      await fixture.addWorktree("merged")
      await fixture.commit("merged")
      await fixture.merge("merged", "merge")
      await integratedIs(fixture, "merged", true)
    }),
  },
  {
    name: "list() of an unknown project fails with the adapter error shape",
    run: withFixture(harness, async (fixture) => {
      const failure = await fixture.adapter.list("no-such-project").then(
        () => fail("list() of an unknown project resolved"),
        (error: unknown) => error,
      )
      if (!isAdapterFailure(failure)) {
        fail(`it failed with ${String(failure)}, not { adapter, op, message, detail }`)
      }
      const { adapter, op } = failure as { adapter: string; op: string }
      if (adapter !== "worktrees" || op !== "list") {
        fail(`it failed as { adapter: "${adapter}", op: "${op}" }, not worktrees/list`)
      }
    }),
  },
]
