/**
 * The `GitOperations` contract suite: `gitTiers` (Live + InMemory), and
 * `runGitServiceContract`, which exercises every one of the 21 `GitOperations`
 * methods identically against whichever tier it's handed. `src/Git.test.ts`
 * calls `runGitServiceContract` over `gitTiers`; `src/ReviewWindow.test.ts`
 * (package/step 5) parameterizes over the same tiers for the review checkout
 * window. Imports `vitest` directly (`describe`/`it`/`expect`) — a leak of
 * this module into the shipped CLI bundle would try to inline `vitest` and
 * fail the build loudly (`deps.alwaysBundle` in `tsdown.config.ts`), a second,
 * independent guard alongside the `TEST_DOUBLE_SENTINEL` check.
 */

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs"
import { join, dirname, basename } from "node:path"
import { tmpdir } from "node:os"
import { execSync, execFileSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService, type GitOperations } from "../Git.js"
import {
  commitAll,
  commitAsIs,
  softResetTo,
  mixedResetTo,
  hardResetTo,
  discardPending,
  updateRef,
  deleteRef,
  restoreStagedFrom,
} from "../GitScript.js"
import { ConfigService } from "../Config.js"
import { Cwd } from "../Cwd.js"
import type { WorkflowDefinition } from "../PatternMachine.js"
import {
  defaultMachineTree,
  defaultStateScopes,
  defaultWorkflowDefinition,
} from "../workflows/templates.js"
import { indexLockError } from "./GitDoubles.js"
import { InMemRepo } from "./InMemRepo.js"
import { gitTestLayer } from "./Layers.js"

// ---------------------------------------------------------------------------
// GitTier
// ---------------------------------------------------------------------------

export interface GitTierCapabilities {
  /** Assert file BYTES on disk, not just index/HEAD state (`hardResetTo`) — only the Live tier has a real working-tree file to read back. */
  readonly onDiskContent: boolean
  /** Install a real `.git/hooks/pre-commit` and prove the `--no-verify` retry — only the Live tier has a hooks directory. */
  readonly commitHooks: boolean
  /** `git worktree add` — sibling linked worktrees sharing one `.git`; the fake models a single worktree only. */
  readonly linkedWorktrees: boolean
  /** A real cwd→home directory chain for config discovery — the fake's `ConfigSource` returns at most one level. */
  readonly directoryChainConfig: boolean
}

export interface GitTierSeed {
  readonly commit: (message: string, files?: Record<string, string>) => void
  readonly writeFile: (path: string, content: string) => void
  readonly deleteFile: (path: string) => void
  readonly commitDeletion: (path: string, message: string) => void
  readonly stageAll: () => void
  readonly updateRef: (ref: string, hash: string) => void
  readonly mixedReset: (ref: string) => void
}

export interface GitTierObserve {
  readonly resolveRef: (ref: string) => string
  readonly statusPorcelain: () => string
  readonly refExists: (ref: string) => boolean
  readonly readWorktreeFile: (path: string) => string
  readonly existsPath: (path: string) => boolean
}

export interface GitTier {
  readonly name: "Live" | "InMemory"
  readonly root: string
  readonly capabilities: GitTierCapabilities
  /** Provide `GitService` (retry-wrapped, exactly as production wires it) + `ConfigService` (defaulting to the bundled template; pass `workflow` for a custom one — see `ReviewWindow.test.ts`). */
  readonly provide: <A>(
    eff: Effect.Effect<A, Error, GitService | ConfigService>,
    workflow?: WorkflowDefinition,
  ) => Promise<A>
  readonly provideExit: <A>(
    eff: Effect.Effect<A, Error, GitService | ConfigService>,
    workflow?: WorkflowDefinition,
  ) => Promise<Exit.Exit<A, Error>>
  /** A second, commit-less repo of the same tier — for the empty-repo edge cases (`commitHistory`, `hasCommits`). */
  readonly emptyRepo: () => GitTier
  readonly seed: GitTierSeed
  readonly observe: GitTierObserve
  /** Arrange for the tier's NEXT index-writing operation to hit an `index.lock` failure that then clears — proves the retry wiring on both tiers. */
  readonly induceIndexLockOnce: () => void
  readonly dispose: () => void
}

const configLayerFor = (workflow: WorkflowDefinition): Layer.Layer<ConfigService> =>
  Layer.succeed(ConfigService, {
    load: Effect.succeed({
      workflow,
      workflowVars: {},
      rcVars: {},
      machineTree: defaultMachineTree,
      stateScopes: defaultStateScopes,
    }),
  })

// ---------------------------------------------------------------------------
// Live tier
// ---------------------------------------------------------------------------

const gitExecIn = (dir: string, ...args: string[]): string =>
  execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim()

const makeLiveTier = (initialCommit = true): GitTier => {
  // realpath'd once here so `t.root` matches `git rev-parse --show-toplevel`'s
  // OWN symlink resolution byte-for-byte (macOS's tmpdir is under `/tmp`, a
  // symlink to `/private/tmp` — `git` reports the resolved path).
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-git-tier-")))
  const gitExec = (...args: string[]) => gitExecIn(root, ...args)
  gitExec("init")
  gitExec(`config user.email "test@test.com"`)
  gitExec(`config user.name "Test"`)
  gitExec("config", "commit.gpgsign", "false")
  if (initialCommit) {
    writeFileSync(join(root, "readme.txt"), "hello")
    gitExec("add", "-A")
    gitExec(`commit -m "init: first commit"`)
  }

  const provide = <A>(
    eff: Effect.Effect<A, Error, GitService | ConfigService>,
    workflow: WorkflowDefinition = defaultWorkflowDefinition,
  ): Promise<A> =>
    Effect.runPromise(
      eff.pipe(
        Effect.provide(GitService.Live),
        Effect.provide(configLayerFor(workflow)),
        Effect.provide(Cwd.layer(root)),
        Effect.provide(NodeContext.layer),
      ),
    )

  const provideExit = <A>(
    eff: Effect.Effect<A, Error, GitService | ConfigService>,
    workflow: WorkflowDefinition = defaultWorkflowDefinition,
  ): Promise<Exit.Exit<A, Error>> =>
    Effect.runPromiseExit(
      eff.pipe(
        Effect.provide(GitService.Live),
        Effect.provide(configLayerFor(workflow)),
        Effect.provide(Cwd.layer(root)),
        Effect.provide(NodeContext.layer),
      ),
    )

  return {
    name: "Live",
    root,
    capabilities: {
      onDiskContent: true,
      commitHooks: true,
      linkedWorktrees: true,
      directoryChainConfig: true,
    },
    provide,
    provideExit,
    emptyRepo: () => makeLiveTier(false),
    seed: {
      commit: (message, files = { "file.txt": message }) => {
        for (const [path, content] of Object.entries(files)) {
          mkdirSync(dirname(join(root, path)), { recursive: true })
          writeFileSync(join(root, path), content)
        }
        gitExec("add", "-A")
        // --allow-empty: a caller passing `files: {}` (no prior staged
        // change either) means a deliberate empty commit — the state-entry
        // shape most `ReviewWindow.test.ts` seeding relies on.
        gitExec(`commit --allow-empty -m "${message}"`)
      },
      writeFile: (path, content) => {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content)
      },
      // A plain unlink, NOT `git rm` — the index is left exactly as it stood,
      // which is the only way to model a reviewer deleting a file the review
      // window left untracked (`git rm` refuses an untracked pathspec), and
      // matches what the in-memory tier's worktree-only delete has always
      // done. Callers that want the deletion staged say `stageAll()`.
      deleteFile: (path) => rmSync(join(root, path), { force: true }),
      commitDeletion: (path, message) => {
        gitExec("rm", path)
        gitExec(`commit -m "${message}"`)
      },
      stageAll: () => gitExec("add", "-A"),
      updateRef: (ref, hash) => gitExec("update-ref", ref, hash),
      mixedReset: (ref) => gitExec("reset", "--mixed", ref),
    },
    observe: {
      resolveRef: (ref) => gitExec("rev-parse", ref),
      statusPorcelain: () => gitExec("status", "--porcelain", "-uall"),
      refExists: (ref) => {
        try {
          gitExec("rev-parse", "--verify", "--quiet", ref)
          return true
        } catch {
          return false
        }
      },
      readWorktreeFile: (path) => readFileSync(join(root, path), "utf8"),
      existsPath: (path) => existsSync(join(root, path)),
    },
    induceIndexLockOnce: () => {
      const lock = join(root, ".git", "index.lock")
      writeFileSync(lock, "")
      setTimeout(() => {
        try {
          rmSync(lock)
        } catch {
          // already removed
        }
      }, 50)
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

// ---------------------------------------------------------------------------
// InMemory tier
// ---------------------------------------------------------------------------

const IN_MEM_ROOT = "/repo"

const makeInMemTier = (initialCommit = true): GitTier => {
  const repo = new InMemRepo()
  if (initialCommit) {
    repo.writeFile("readme.txt", "hello")
    repo.commitAllWithPrefix("init: first commit")
  }
  const gitLayer = gitTestLayer(repo, IN_MEM_ROOT)

  const provide = <A>(
    eff: Effect.Effect<A, Error, GitService | ConfigService>,
    workflow: WorkflowDefinition = defaultWorkflowDefinition,
  ): Promise<A> =>
    Effect.runPromise(eff.pipe(Effect.provide(gitLayer), Effect.provide(configLayerFor(workflow))))

  const provideExit = <A>(
    eff: Effect.Effect<A, Error, GitService | ConfigService>,
    workflow: WorkflowDefinition = defaultWorkflowDefinition,
  ): Promise<Exit.Exit<A, Error>> =>
    Effect.runPromiseExit(
      eff.pipe(Effect.provide(gitLayer), Effect.provide(configLayerFor(workflow))),
    )

  return {
    name: "InMemory",
    root: IN_MEM_ROOT,
    capabilities: {
      onDiskContent: false,
      commitHooks: false,
      linkedWorktrees: false,
      directoryChainConfig: false,
    },
    provide,
    provideExit,
    emptyRepo: () => makeInMemTier(false),
    seed: {
      commit: (message, files = { "file.txt": message }) => {
        for (const [path, content] of Object.entries(files)) repo.writeFile(path, content)
        repo.commitAllWithPrefix(message)
      },
      writeFile: (path, content) => repo.writeFile(path, content),
      deleteFile: (path) => repo.deleteFile(path),
      commitDeletion: (path, message) => {
        repo.deleteFile(path)
        repo.commitAllWithPrefix(message)
      },
      stageAll: () => repo.stageAll(),
      updateRef: (ref, hash) => repo.updateRef(ref, hash),
      mixedReset: (ref) => repo.mixedResetTo(ref),
    },
    observe: {
      resolveRef: (ref) => {
        const hash = repo.resolveRef(ref)
        if (hash === null) throw new Error(`Cannot resolve ref: ${ref}`)
        return hash
      },
      statusPorcelain: () => repo.statusPorcelain(),
      refExists: (ref) => repo.resolveRef(ref) !== null,
      readWorktreeFile: (path) => {
        const content = repo.readFile(path)
        if (content === undefined)
          throw new Error(`ENOENT: no such file or directory, open '${path}'`)
        return content
      },
      existsPath: (path) => repo.hasPath(path),
    },
    induceIndexLockOnce: () => repo.failNextOperations(1, indexLockError),
    dispose: () => {
      // No temp resources to clean up.
    },
  }
}

/** Both tiers, freshly constructed per call — `beforeEach(() => { t = makeTier() })` in every consuming test file. */
export const gitTiers: ReadonlyArray<() => GitTier> = [makeLiveTier, makeInMemTier]

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

const runGit = <A>(t: GitTier, f: (g: GitOperations) => Effect.Effect<A, Error>): Promise<A> =>
  t.provide(Effect.flatMap(GitService, f))

const runGitExit = <A>(
  t: GitTier,
  f: (g: GitOperations) => Effect.Effect<A, Error>,
): Promise<Exit.Exit<A, Error>> => t.provideExit(Effect.flatMap(GitService, f))

/** Every `GitOperations` method the contract below exercises — asserted (in `GitTiers.test.ts`) to equal `fakeGitOperations`'s own key set, so a new port method can't go uncovered. */
export const CONTRACT_COVERED_OPERATIONS: ReadonlySet<keyof GitOperations> = new Set([
  "lastCommitSubject",
  "lastCommitMessage",
  "hasCommits",
  "resolveRef",
  "readRefOption",
  "isAncestor",
  "topLevel",
  "gitDir",
  "commitHistory",
  "readFileAtRef",
  "changedPaths",
  "changedPathsSince",
  "commitAllWithPrefix",
  "softResetTo",
  "commitAsIs",
  "discardPending",
  "updateRef",
  "deleteRef",
  "mixedResetTo",
  "hardResetTo",
  "restoreStagedFrom",
])

/**
 * Exercise all 20 `GitOperations` methods identically against `makeTier()` —
 * called once per tier by `src/Git.test.ts`. A capability-gated group
 * (`t.capabilities.X`) is skipped, not faked, on a tier that can't support it.
 */
// fallow-ignore-next-line complexity
export const runGitServiceContract = (makeTier: () => GitTier): void => {
  // Capabilities are static per tier type — probed once so `it.skipIf(...)`
  // predicates below can read them at DESCRIBE time (`t` itself isn't
  // assigned until the first `beforeEach` runs, which is too late for a
  // skipIf predicate evaluated while the suite is still being built).
  const probe = makeTier()
  const capabilities = probe.capabilities
  probe.dispose()

  let t: GitTier

  beforeEach(() => {
    t = makeTier()
  })

  afterEach(() => {
    t.dispose()
  })

  describe("changedPathsSince", () => {
    it("returns the paths changed since ref, with their status, excluding paths before it", async () => {
      t.seed.commit("feat: second commit", { "foo.txt": "foo content" })
      t.seed.commit("feat: third commit", { "bar.txt": "bar content" })
      const changed = await runGit(t, (g) => g.changedPathsSince("HEAD~1"))
      expect(changed).toEqual([{ path: "bar.txt", status: "A" }])
    })

    it("reports an added, a modified, and a deleted path across the range", async () => {
      t.seed.commit("chore: add other.txt", { "other.txt": "will be removed" })
      const base = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: modify readme, add new.txt", {
        "readme.txt": "changed",
        "new.txt": "new",
      })
      t.seed.deleteFile("other.txt")
      t.seed.stageAll()
      t.seed.commit("chore: remove other.txt", {})
      const changed = await runGit(t, (g) => g.changedPathsSince(base))
      expect([...changed].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
        { path: "new.txt", status: "A" },
        { path: "other.txt", status: "D" },
        { path: "readme.txt", status: "M" },
      ])
    })

    it("returns [] when ref equals HEAD", async () => {
      const changed = await runGit(t, (g) => g.changedPathsSince("HEAD"))
      expect(changed).toEqual([])
    })

    it("fails for an unreachable ref", async () => {
      const result = await runGitExit(t, (g) => g.changedPathsSince("totally-invalid-ref-xyz"))
      expect(Exit.isFailure(result)).toBe(true)
    })
  })

  describe("resolveRef", () => {
    it("resolves HEAD to a 40-char hash", async () => {
      const hash = await runGit(t, (g) => g.resolveRef("HEAD"))
      expect(hash).toMatch(/^[0-9a-f]{40}$/)
    })

    it("resolves HEAD~1 when two commits exist", async () => {
      t.seed.commit("feat: second commit", { "extra.txt": "extra" })
      const headHash = t.observe.resolveRef("HEAD~1")
      const resolved = await runGit(t, (g) => g.resolveRef("HEAD~1"))
      expect(resolved).toBe(headHash)
    })

    it("errors on invalid ref", async () => {
      const result = await runGitExit(t, (g) => g.resolveRef("totally-invalid-ref-xyz"))
      expect(Exit.isFailure(result)).toBe(true)
    })
  })

  describe("lastCommitSubject", () => {
    it("returns HEAD's subject with no ref argument", async () => {
      const subject = await runGit(t, (g) => g.lastCommitSubject())
      expect(subject).toBe("init: first commit")
    })

    it("returns the given ref's subject, not HEAD's", async () => {
      t.seed.commit("feat: second commit", { "extra.txt": "extra" })
      const subject = await runGit(t, (g) => g.lastCommitSubject("HEAD~1"))
      expect(subject).toBe("init: first commit")
    })
  })

  describe("lastCommitMessage", () => {
    it("returns the full commit message (subject + body) of HEAD", async () => {
      t.seed.commit("feat: add thing\n\nA body explaining why.")
      const message = await runGit(t, (g) => g.lastCommitMessage())
      expect(message).toBe("feat: add thing\n\nA body explaining why.")
    })

    it("returns just the subject when HEAD carries no body", async () => {
      t.seed.commit("feat: subject only")
      const message = await runGit(t, (g) => g.lastCommitMessage())
      expect(message).toBe("feat: subject only")
    })
  })

  describe("hasCommits", () => {
    it("returns false in an empty repo", async () => {
      const empty = t.emptyRepo()
      try {
        expect(await runGit(empty, (g) => g.hasCommits())).toBe(false)
      } finally {
        empty.dispose()
      }
    })

    it("returns true once a commit exists", async () => {
      expect(await runGit(t, (g) => g.hasCommits())).toBe(true)
    })
  })

  describe("commitHistory", () => {
    it("returns [] for an empty repo", async () => {
      const empty = t.emptyRepo()
      try {
        expect(await runGit(empty, (g) => g.commitHistory())).toEqual([])
      } finally {
        empty.dispose()
      }
    })

    it("returns all commits oldest to newest with their messages", async () => {
      t.seed.commit("feat: second", { "b.txt": "b" })
      t.seed.commit("feat: third", { "c.txt": "c" })
      const result = await runGit(t, (g) => g.commitHistory())
      expect(result.length).toBe(3)
      expect(result[0]?.message).toBe("init: first commit")
      expect(result[2]?.message).toBe("feat: third")
    })

    it("sets removedErrors=true only for the commit that deleted ERRORS.md", async () => {
      t.seed.commit("gtd: test-failed", { "ERRORS.md": "some errors" })
      t.seed.commitDeletion("ERRORS.md", "gtd: building")
      t.seed.commit("feat: after", { "after.txt": "after" })
      const result = await runGit(t, (g) => g.commitHistory())
      expect(result[0]?.removedErrors).toBe(false)
      expect(result[1]?.removedErrors).toBe(false)
      expect(result[2]?.removedErrors).toBe(true)
      expect(result[3]?.removedErrors).toBe(false)
    })

    it("limits to base..HEAD range when base is provided", async () => {
      t.seed.commit("feat: second", { "b.txt": "b" })
      const base = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: third", { "c.txt": "c" })
      const result = await runGit(t, (g) => g.commitHistory(base))
      expect(result.length).toBe(1)
      expect(result[0]?.message).toBe("feat: third")
    })

    it("resolves a `<head>~1` base — never just an already-resolved hash — to exactly the head commit", async () => {
      t.seed.commit("feat: second", { "b.txt": "b" })
      const head = t.observe.resolveRef("HEAD")
      const result = await runGit(t, (g) => g.commitHistory(`${head}~1`, head))
      expect(result.length).toBe(1)
      expect(result[0]?.message).toBe("feat: second")
    })

    it("reports the paths each commit's name-status diff touched, without extra subprocesses", async () => {
      t.seed.commit("feat: add two files", { "a.txt": "a", "b.txt": "b" })
      t.seed.commitDeletion("a.txt", "chore: remove a")
      const result = await runGit(t, (g) => g.commitHistory())
      const addTwo = result.find((c) => c.message === "feat: add two files")
      const removeA = result.find((c) => c.message === "chore: remove a")
      expect(addTwo?.touched).toEqual(expect.arrayContaining(["a.txt", "b.txt"]))
      expect(removeA?.touched).toEqual(["a.txt"])
    })

    it("reports touched: [] for an empty commit — Edge.ts's headTurn.empty depends on this", async () => {
      await runGit(t, (g) => g.commitAllWithPrefix("gtd(agent): working"))
      const result = await runGit(t, (g) => g.commitHistory())
      expect(result[result.length - 1]?.touched).toEqual([])
    })

    it("reads through an explicit head ref instead of literal HEAD when given one", async () => {
      t.seed.commit("feat: second", { "b.txt": "b" })
      const earlierHead = t.observe.resolveRef("HEAD")
      // Moves real HEAD forward — a `head` argument must stop the walk at
      // `earlierHead` instead, proving the read goes through the given ref
      // rather than the literal `HEAD` the git CLI would default to.
      t.seed.commit("feat: third", { "c.txt": "c" })
      const result = await runGit(t, (g) => g.commitHistory(undefined, earlierHead))
      expect(result.map((c) => c.message)).toEqual(["init: first commit", "feat: second"])
    })
  })

  describe("commitAllWithPrefix", () => {
    it("stages all pending changes and commits with the given prefix as the message", async () => {
      t.seed.writeFile("new.ts", "export const x = 1")
      t.seed.writeFile("TODO.md", "# Plan")
      const headBefore = t.observe.resolveRef("HEAD")
      await runGit(t, (g) => g.commitAllWithPrefix("gtd: building"))
      expect(t.observe.resolveRef("HEAD")).not.toBe(headBefore)
      const history = await runGit(t, (g) => g.commitHistory())
      expect(history[history.length - 1]?.message).toBe("gtd: building")
      expect(t.observe.statusPorcelain().trim()).toBe("")
    })

    it("commits even on a clean tree (--allow-empty) so a fixed-prefix commit never throws", async () => {
      const headBefore = t.observe.resolveRef("HEAD")
      await runGit(t, (g) => g.commitAllWithPrefix("gtd: grilled"))
      expect(t.observe.resolveRef("HEAD")).not.toBe(headBefore)
      const history = await runGit(t, (g) => g.commitHistory())
      expect(history[history.length - 1]?.message).toBe("gtd: grilled")
    })

    it.skipIf(!capabilities.commitHooks)(
      "retries with --no-verify when a hook blocks the empty commit",
      async () => {
        const hookPath = join(t.root, ".git/hooks/pre-commit")
        writeFileSync(
          hookPath,
          `#!/bin/sh\necho "lint-staged prevented an empty git commit." >&2\nexit 1\n`,
        )
        execSync(`chmod +x "${hookPath}"`)
        const headBefore = t.observe.resolveRef("HEAD")
        await runGit(t, (g) => g.commitAllWithPrefix("gtd: grilled"))
        expect(t.observe.resolveRef("HEAD")).not.toBe(headBefore)
        const history = await runGit(t, (g) => g.commitHistory())
        expect(history[history.length - 1]?.message).toBe("gtd: grilled")
      },
    )
  })

  describe("commitAsIs", () => {
    it("commits exactly what's staged, ignoring later worktree writes (the squash mechanic)", async () => {
      t.seed.writeFile("a.txt", "a")
      t.seed.stageAll()
      t.seed.writeFile("b.txt", "b")
      await runGit(t, (g) => g.commitAsIs("feat: squash"))
      const history = await runGit(t, (g) => g.commitHistory())
      expect(history[history.length - 1]?.message).toBe("feat: squash")
      // HEAD's tree has a.txt (staged before the commit)...
      expect(await runGit(t, (g) => g.readFileAtRef("HEAD", "a.txt"))).toContain("a")
      // ...and not b.txt (written to the worktree AFTER staging).
      const bAtHead = await runGitExit(t, (g) => g.readFileAtRef("HEAD", "b.txt"))
      expect(Exit.isFailure(bAtHead)).toBe(true)
    })

    it("commits even on a clean index (--allow-empty)", async () => {
      const headBefore = t.observe.resolveRef("HEAD")
      await runGit(t, (g) => g.commitAsIs("gtd: empty squash"))
      expect(t.observe.resolveRef("HEAD")).not.toBe(headBefore)
    })
  })

  describe("softResetTo", () => {
    it("moves HEAD back but keeps worktree changes from second commit", async () => {
      const firstHash = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: second", { "second.txt": "second content" })
      await runGit(t, (g) => g.softResetTo(firstHash))
      expect(t.observe.resolveRef("HEAD")).toBe(firstHash)
      expect(t.observe.statusPorcelain()).toContain("second.txt")
    })
  })

  describe("hardResetTo", () => {
    it("moves HEAD, index, and working tree content back to the target ref", async () => {
      const firstHash = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: second", { "readme.txt": "modified content" })
      await runGit(t, (g) => g.hardResetTo(firstHash))
      expect(t.observe.resolveRef("HEAD")).toBe(firstHash)
      expect(t.observe.statusPorcelain()).toBe("")
      if (t.capabilities.onDiskContent) {
        expect(t.observe.readWorktreeFile("readme.txt")).toBe("hello")
      }
    })
  })

  describe("mixedResetTo", () => {
    it("moves HEAD and index, leaving the working tree untouched — the reset commit's content re-surfaces as pending", async () => {
      const firstHash = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: second", { "second.txt": "second content" })
      await runGit(t, (g) => g.mixedResetTo(firstHash))
      expect(t.observe.resolveRef("HEAD")).toBe(firstHash)
      expect(t.observe.statusPorcelain()).toContain("second.txt")
    })
  })

  describe("discardPending", () => {
    it("discards every pending change, tracked or untracked", async () => {
      t.seed.writeFile("readme.txt", "modified")
      t.seed.writeFile("untracked.txt", "new")
      await runGit(t, (g) => g.discardPending())
      expect(t.observe.statusPorcelain()).toBe("")
    })
  })

  describe("updateRef / deleteRef / readRefOption", () => {
    it("updateRef points a ref at a commit; readRefOption resolves it", async () => {
      const head = t.observe.resolveRef("HEAD")
      await runGit(t, (g) => g.updateRef("refs/gtd/marker", head))
      const resolved = await runGit(t, (g) => g.readRefOption("refs/gtd/marker"))
      expect(resolved._tag).toBe("Some")
      if (resolved._tag === "Some") expect(resolved.value).toBe(head)
    })

    it("readRefOption is None for a ref that doesn't exist — never a failure", async () => {
      const resolved = await runGit(t, (g) => g.readRefOption("refs/gtd/nonexistent"))
      expect(resolved._tag).toBe("None")
    })

    it("deleteRef removes a ref idempotently (deleting twice is a no-op)", async () => {
      const head = t.observe.resolveRef("HEAD")
      await runGit(t, (g) => g.updateRef("refs/gtd/marker", head))
      await runGit(t, (g) => g.deleteRef("refs/gtd/marker"))
      await runGit(t, (g) => g.deleteRef("refs/gtd/marker"))
      const resolved = await runGit(t, (g) => g.readRefOption("refs/gtd/marker"))
      expect(resolved._tag).toBe("None")
    })
  })

  describe("isAncestor", () => {
    it("is true for an ancestor commit", async () => {
      const base = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: second", { "b.txt": "b" })
      const tip = t.observe.resolveRef("HEAD")
      expect(await runGit(t, (g) => g.isAncestor(base, tip))).toBe(true)
    })

    it("is false for a diverged tip (neither is the other's ancestor)", async () => {
      const base = t.observe.resolveRef("HEAD")
      t.seed.updateRef("refs/gtd/side", base)
      t.seed.commit("feat: main-branch-work", { "m.txt": "m" })
      const mainTip = t.observe.resolveRef("HEAD")
      await runGit(t, (g) => g.mixedResetTo(base))
      t.seed.writeFile("s.txt", "s")
      t.seed.stageAll()
      t.seed.commit("feat: side-branch-work", {})
      const sideTip = t.observe.resolveRef("HEAD")
      expect(await runGit(t, (g) => g.isAncestor(mainTip, sideTip))).toBe(false)
    })

    it("is false (never a failure) for a nonexistent ref", async () => {
      expect(await runGit(t, (g) => g.isAncestor("totally-invalid-ref", "HEAD"))).toBe(false)
    })
  })

  describe("readFileAtRef", () => {
    it("reads a file's content as it stood at a given ref", async () => {
      const base = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: change readme", { "readme.txt": "changed" })
      const content = await runGit(t, (g) => g.readFileAtRef(base, "readme.txt"))
      expect(content.trim()).toBe("hello")
    })

    it("fails when the path does not exist at that ref", async () => {
      const result = await runGitExit(t, (g) => g.readFileAtRef("HEAD", "nonexistent.txt"))
      expect(Exit.isFailure(result)).toBe(true)
    })
  })

  describe("changedPaths", () => {
    it("unions a tracked modification, a tracked deletion, and an untracked addition, deduplicated by path", async () => {
      t.seed.commit("chore: seed", { "modme.txt": "orig", "delme.txt": "bye" })
      t.seed.writeFile("modme.txt", "changed")
      t.seed.deleteFile("delme.txt")
      t.seed.writeFile("newfile.txt", "new")
      const changed = await runGit(t, (g) => g.changedPaths())
      const byPath = Object.fromEntries(changed.map((c) => [c.path, c.status]))
      expect(byPath["modme.txt"]).toBe("M")
      expect(byPath["delme.txt"]).toBe("D")
      expect(byPath["newfile.txt"]).toBe("A")
    })

    it("returns [] on a clean tree", async () => {
      expect(await runGit(t, (g) => g.changedPaths())).toEqual([])
    })

    // The review checkout window's own shape: `git reset --mixed <base>` drops
    // every path the reviewed range ADDED out of the index, leaving it
    // untracked but present on disk. An index-based answer calls each of those
    // a deletion (`git diff --name-status <base>` compares base to the INDEX),
    // which made the review-doc guard refuse every sign-off whose
    // `reviewFile` the window does not pin back. The port answers by CONTENT
    // instead — these four cases are that contract.
    describe("with a base, over paths the index no longer carries", () => {
      /** Commit `REVIEW.md` on top of a seed commit, then rewind the index to that seed — the window's own state. Returns the saved head the window would measure against. */
      const openWindowOver = (content: string): string => {
        t.seed.commit("chore: seed", { "kept.txt": "seed" })
        const base = t.observe.resolveRef("HEAD")
        t.seed.commit("gtd(agent): reviewing", { "REVIEW.md": content })
        const head = t.observe.resolveRef("HEAD")
        t.seed.mixedReset(base)
        return head
      }

      it("omits an untracked path whose bytes match the base — present and unchanged is not a change", async () => {
        const head = openWindowOver("- [ ] one\n")
        expect(await runGit(t, (g) => g.changedPaths(head))).toEqual([])
      })

      it("reports an untracked path edited since the base as M, never D", async () => {
        const head = openWindowOver("- [ ] one\n")
        t.seed.writeFile("REVIEW.md", "- [x] one\n")
        expect(await runGit(t, (g) => g.changedPaths(head))).toEqual([
          { path: "REVIEW.md", status: "M" },
        ])
      })

      it("reports an untracked path REMOVED from disk as D — the deletion the review-doc guard must catch", async () => {
        const head = openWindowOver("- [ ] one\n")
        t.seed.deleteFile("REVIEW.md")
        expect(await runGit(t, (g) => g.changedPaths(head))).toEqual([
          { path: "REVIEW.md", status: "D" },
        ])
      })

      it("still reports a genuinely new untracked path as A", async () => {
        const head = openWindowOver("- [ ] one\n")
        t.seed.writeFile("NOTE.md", "a reviewer's note\n")
        expect(await runGit(t, (g) => g.changedPaths(head))).toEqual([
          { path: "NOTE.md", status: "A" },
        ])
      })

      // "Different bytes" has to mean what GIT means by it. Under
      // `text=auto` the committed blob is normalized to LF while the working
      // tree legitimately holds CRLF, so a RAW byte comparison calls an
      // untouched file modified — and a spurious `M` on the review doc is a
      // spurious "the human edited something real" (`StepGuards`'s
      // `hasCodeChange`), which flips a clean sign-off onto the feedback edge
      // — a full re-plan nobody asked for. The fake has no filters at all, so it answers
      // "unchanged" by construction; this pins real git to the same answer.
      it("omits an untracked path that only differs by a clean filter's normalization", async () => {
        t.seed.writeFile(".gitattributes", "* text=auto\n")
        t.seed.commit("chore: normalize line endings", {})
        const base = t.observe.resolveRef("HEAD")
        // Committed through `git add`, so the blob is normalized to LF while
        // the file on disk keeps its CRLF bytes.
        t.seed.writeFile("REVIEW.md", "- [ ] one\r\n- [ ] two\r\n")
        t.seed.commit("gtd(agent): reviewing", {})
        const head = t.observe.resolveRef("HEAD")
        t.seed.mixedReset(base)
        expect(await runGit(t, (g) => g.changedPaths(head))).toEqual([])
      })

      it("still reports a real edit to such a path as M", async () => {
        t.seed.writeFile(".gitattributes", "* text=auto\n")
        t.seed.commit("chore: normalize line endings", {})
        const base = t.observe.resolveRef("HEAD")
        t.seed.writeFile("REVIEW.md", "- [ ] one\r\n- [ ] two\r\n")
        t.seed.commit("gtd(agent): reviewing", {})
        const head = t.observe.resolveRef("HEAD")
        t.seed.mixedReset(base)
        t.seed.writeFile("REVIEW.md", "- [x] one\r\n- [ ] two\r\n")
        expect(await runGit(t, (g) => g.changedPaths(head))).toEqual([
          { path: "REVIEW.md", status: "M" },
        ])
      })
    })
  })

  describe("topLevel", () => {
    it("resolves to this tier's own root", async () => {
      expect(await runGit(t, (g) => g.topLevel())).toBe(t.root)
    })
  })

  describe("gitDir", () => {
    it("resolves to an absolute path ending in .git, for the main worktree", async () => {
      const dir = await runGit(t, (g) => g.gitDir())
      expect(dir).toBe(join(t.root, ".git"))
    })

    it.skipIf(!capabilities.linkedWorktrees)(
      "resolves to a linked worktree's own private .git/worktrees/<name> dir, not the main worktree's",
      async () => {
        const siblingDir = `${t.root}-gitdir-sibling`
        gitExecIn(t.root, "worktree", "add", "-q", "-b", "gitdir-sibling", siblingDir, "HEAD")
        try {
          const mainGitDir = await runGit(t, (g) => g.gitDir())
          const siblingGitDir = await Effect.runPromise(
            Effect.flatMap(GitService, (g) => g.gitDir()).pipe(
              Effect.provide(GitService.Live),
              Effect.provide(Cwd.layer(siblingDir)),
              Effect.provide(NodeContext.layer),
            ),
          )
          expect(siblingGitDir).not.toBe(mainGitDir)
          // git names a linked worktree's internal directory after the
          // worktree PATH's basename, not the `-b` branch name given below.
          expect(siblingGitDir).toBe(join(mainGitDir, "worktrees", basename(siblingDir)))
        } finally {
          rmSync(siblingDir, { recursive: true, force: true })
        }
      },
    )
  })

  describe("restoreStagedFrom", () => {
    it("pins the index for the given paths back to their state at source, leaving HEAD/worktree untouched", async () => {
      const base = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: touch plumbing", { ".gtd/TODO.md": "sketch" })
      const beforeHead = t.observe.resolveRef("HEAD")
      await runGit(t, (g) => g.restoreStagedFrom(base, [".gtd"]))
      expect(t.observe.resolveRef("HEAD")).toBe(beforeHead)
      // The plumbing file is pinned out of the index — surfaces as a staged
      // deletion (present at HEAD, absent from `base`, so restored to absent).
      expect(t.observe.statusPorcelain()).toContain(".gtd/TODO.md")
    })

    it("is tolerant of a path absent at source (best-effort plumbing pin)", async () => {
      const base = t.observe.resolveRef("HEAD")
      const result = await runGitExit(t, (g) => g.restoreStagedFrom(base, [".gtd/never-existed"]))
      expect(Exit.isSuccess(result)).toBe(true)
    })

    it("survives an induced index.lock (the step-2 catchIf narrowing)", async () => {
      const base = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: touch plumbing", { ".gtd/TODO.md": "sketch" })
      t.induceIndexLockOnce()
      const result = await runGitExit(t, (g) => g.restoreStagedFrom(base, [".gtd"]))
      expect(Exit.isSuccess(result)).toBe(true)
    })
  })

  describe("retry wiring — an operation obtained from the layer survives induceIndexLockOnce()", () => {
    it("commitAllWithPrefix retries through a lock that clears mid-flight", async () => {
      t.induceIndexLockOnce()
      t.seed.writeFile("locked.txt", "content")
      const result = await runGitExit(t, (g) => g.commitAllWithPrefix("gtd(test): capture"))
      expect(Exit.isSuccess(result)).toBe(true)
      expect(t.observe.resolveRef("HEAD")).not.toBe(undefined)
    })
  })
}

// ---------------------------------------------------------------------------
// The GitScript contract — real bash, real git, no GitOperations port at all
// ---------------------------------------------------------------------------

/**
 * Runs a `GitScript.ts` builder's output through a REAL shell against `t.root`
 * — the same execution model the eventual driver uses (`bash -c <script>`),
 * so a builder that's syntactically fine but semantically wrong (a missing
 * `&&`, a misquoted path) fails here exactly as it would in production.
 */
const execScript = (t: GitTier, script: string): void => {
  execFileSync("bash", ["-c", script], { cwd: t.root, stdio: "pipe" })
}

/** Names touched by HEAD's own commit — `git show`'s diff against its parent, not the whole tree. */
const headTouchedPaths = (t: GitTier): ReadonlyArray<string> =>
  gitExecIn(t.root, "show", "--name-only", "--pretty=format:", "HEAD")
    .split("\n")
    .filter((line) => line.length > 0)

const headSubject = (t: GitTier): string => gitExecIn(t.root, "log", "-1", "--pretty=%s")

/**
 * The SAME 9 writer postconditions `runGitServiceContract` asserts against
 * `GitOperations`, asserted here against `GitScript.ts`'s bash builders
 * instead — driven through real `bash` against a real repo (`makeLiveTier`),
 * never the in-memory fake, since a fake root (`/repo`) has no shell to run
 * against. Proves the script translation preserves every edge case the doc
 * comments in `GitScript.ts` call out, not just the happy path.
 */
export const runGitScriptContract = (): void => {
  let t: GitTier

  beforeEach(() => {
    t = makeLiveTier()
  })

  afterEach(() => {
    t.dispose()
  })

  describe("commitAll", () => {
    it("stages (git add -A) before committing — a new untracked file lands in the commit", () => {
      t.seed.writeFile("new.ts", "export const x = 1")
      const headBefore = t.observe.resolveRef("HEAD")
      execScript(t, commitAll("gtd: building"))
      expect(t.observe.resolveRef("HEAD")).not.toBe(headBefore)
      expect(headSubject(t)).toBe("gtd: building")
      expect(headTouchedPaths(t)).toEqual(["new.ts"])
      expect(t.observe.statusPorcelain().trim()).toBe("")
    })

    it("commits even on a clean tree (--allow-empty), never 'nothing to commit'", () => {
      const headBefore = t.observe.resolveRef("HEAD")
      execScript(t, commitAll("gtd: grilled"))
      expect(t.observe.resolveRef("HEAD")).not.toBe(headBefore)
      expect(headSubject(t)).toBe("gtd: grilled")
    })
  })

  describe("commitAsIs", () => {
    it("does NOT stage — a worktree write after staging is excluded (the squash mechanic)", () => {
      t.seed.writeFile("a.txt", "a")
      t.seed.stageAll()
      t.seed.writeFile("b.txt", "b")
      execScript(t, commitAsIs("feat: squash"))
      expect(headSubject(t)).toBe("feat: squash")
      expect(headTouchedPaths(t)).toEqual(["a.txt"])
    })

    it("commits even on a clean index (--allow-empty), never 'nothing to commit'", () => {
      const headBefore = t.observe.resolveRef("HEAD")
      execScript(t, commitAsIs("gtd: empty squash"))
      expect(t.observe.resolveRef("HEAD")).not.toBe(headBefore)
      expect(headSubject(t)).toBe("gtd: empty squash")
    })
  })

  describe("softResetTo", () => {
    it("moves HEAD back but keeps worktree changes from the second commit", () => {
      const firstHash = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: second", { "second.txt": "second content" })
      execScript(t, softResetTo(firstHash))
      expect(t.observe.resolveRef("HEAD")).toBe(firstHash)
      expect(t.observe.statusPorcelain()).toContain("second.txt")
    })
  })

  describe("hardResetTo", () => {
    it("moves HEAD, index, and working tree content back to the target ref", () => {
      const firstHash = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: second", { "readme.txt": "modified content" })
      execScript(t, hardResetTo(firstHash))
      expect(t.observe.resolveRef("HEAD")).toBe(firstHash)
      expect(t.observe.statusPorcelain()).toBe("")
      expect(t.observe.readWorktreeFile("readme.txt")).toBe("hello")
    })
  })

  describe("mixedResetTo", () => {
    it("moves HEAD and index, leaving the working tree untouched", () => {
      const firstHash = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: second", { "second.txt": "second content" })
      execScript(t, mixedResetTo(firstHash))
      expect(t.observe.resolveRef("HEAD")).toBe(firstHash)
      expect(t.observe.statusPorcelain()).toContain("second.txt")
    })
  })

  describe("discardPending", () => {
    it("drops both tracked modifications and untracked files", () => {
      t.seed.writeFile("readme.txt", "modified")
      t.seed.writeFile("untracked.txt", "new")
      execScript(t, discardPending())
      expect(t.observe.statusPorcelain()).toBe("")
    })
  })

  describe("updateRef / deleteRef", () => {
    it("updateRef points a ref at a commit", () => {
      const head = t.observe.resolveRef("HEAD")
      execScript(t, updateRef("refs/gtd/marker", head))
      expect(t.observe.refExists("refs/gtd/marker")).toBe(true)
      expect(t.observe.resolveRef("refs/gtd/marker")).toBe(head)
    })

    it("deleteRef removes an existing ref, and tolerates deleting it again", () => {
      const head = t.observe.resolveRef("HEAD")
      execScript(t, updateRef("refs/gtd/marker", head))
      execScript(t, deleteRef("refs/gtd/marker"))
      execScript(t, deleteRef("refs/gtd/marker"))
      expect(t.observe.refExists("refs/gtd/marker")).toBe(false)
    })

    it("deleteRef tolerates a ref that was never created", () => {
      expect(() => execScript(t, deleteRef("refs/gtd/never-created"))).not.toThrow()
      expect(t.observe.refExists("refs/gtd/never-created")).toBe(false)
    })
  })

  describe("restoreStagedFrom", () => {
    it("pins the index for the given paths back to source, leaving HEAD/worktree untouched", () => {
      const base = t.observe.resolveRef("HEAD")
      t.seed.commit("feat: touch plumbing", { ".gtd/TODO.md": "sketch" })
      const beforeHead = t.observe.resolveRef("HEAD")
      execScript(t, restoreStagedFrom(base, [".gtd"]))
      expect(t.observe.resolveRef("HEAD")).toBe(beforeHead)
      // Present at HEAD, absent from `base` — pinning to `base` surfaces as a
      // staged deletion, mirroring `restoreStagedFrom`'s existing port test.
      expect(t.observe.statusPorcelain()).toContain(".gtd/TODO.md")
    })

    it("is tolerant of a path absent at source (best-effort plumbing pin)", () => {
      const base = t.observe.resolveRef("HEAD")
      expect(() => execScript(t, restoreStagedFrom(base, [".gtd/never-existed"]))).not.toThrow()
    })
  })
}
