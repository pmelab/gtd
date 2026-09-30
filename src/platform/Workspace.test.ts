import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import * as childProcess from "node:child_process"
import { execSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService, Host, Workspace, type WorkspaceOps } from "./index.js"
import { InMemRepo, makeInMemoryWorkspaceOps } from "../testing/index.js"

// `execFileSync` is a named export of the built-in `node:child_process` ESM
// module — not configurable, so `vi.spyOn` can't wrap it directly. `vi.mock`
// with `importOriginal` swaps in a `vi.fn` that still calls straight through,
// so every test in this file (not just the ones counting calls) behaves
// exactly as before; only tests that inspect `execFileSyncSpy.mock.calls`
// (after `.mockClear()`) actually observe it.
const execFileSyncSpy = vi.hoisted(() => vi.fn())
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  execFileSyncSpy.mockImplementation(actual.execFileSync)
  return { ...actual, execFileSync: execFileSyncSpy }
})

/**
 * One `Workspace` tier, in the shape `src/testing/GitTiers.ts` establishes
 * for `GitOperations`: a `root`, a way to seed working-tree/committed
 * content, and `provide` to run an Effect against this tier's `Workspace`.
 */
interface WorkspaceTier {
  readonly root: string
  readonly writeWorking: (path: string, content: string) => void
  readonly commit: (path: string, content: string) => void
  readonly provide: <A>(eff: Effect.Effect<A, Error, Workspace>) => Promise<A>
  readonly dispose: () => void
}

const gitExecIn = (dir: string, ...args: string[]): string =>
  execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim()

const makeLiveTier = (): WorkspaceTier => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-workspace-tier-")))
  gitExecIn(root, "init", "-q")
  gitExecIn(root, "config", "user.email", "test@test.com")
  gitExecIn(root, "config", "user.name", "Test")
  gitExecIn(root, "config", "commit.gpgsign", "false")

  const hostLayer = Host.layer({ root, home: root, env: {} })
  const gitLayer = GitService.Live.pipe(Layer.provide(Layer.merge(hostLayer, NodeContext.layer)))
  const workspaceLayer = Workspace.Live.pipe(Layer.provide(Layer.merge(hostLayer, gitLayer)))

  return {
    root,
    writeWorking: (path, content) => {
      mkdirSync(join(root, path, ".."), { recursive: true })
      writeFileSync(join(root, path), content)
    },
    commit: (path, content) => {
      mkdirSync(join(root, path, ".."), { recursive: true })
      writeFileSync(join(root, path), content)
      gitExecIn(root, "add", "-A")
      gitExecIn(root, "commit", "-m", `commit ${path}`)
    },
    provide: (eff) => Effect.runPromise(eff.pipe(Effect.provide(workspaceLayer))),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

const makeInMemTier = (): WorkspaceTier => {
  const root = "/repo"
  const repo = new InMemRepo()
  const workspaceOps = makeInMemoryWorkspaceOps(repo, root)
  return {
    root,
    writeWorking: (path, content) => repo.writeFile(path, content),
    commit: (path, content) => {
      repo.writeFile(path, content)
      repo.commitAllWithPrefix(`commit ${path}`)
    },
    provide: (eff) =>
      Effect.runPromise(eff.pipe(Effect.provide(Layer.succeed(Workspace, workspaceOps)))),
    dispose: () => {},
  }
}

/** `{ name, make }` rather than a bare factory array: `describe`'s title needs a name at COLLECTION time, before any test body runs — calling `make()` just to read a `.name` off the built tier would construct (and, for Live, `git init` a real tmpdir) a tier nothing then disposes. */
const tiers: ReadonlyArray<{
  readonly name: "Live" | "InMemory"
  readonly make: () => WorkspaceTier
}> = [
  { name: "Live", make: makeLiveTier },
  { name: "InMemory", make: makeInMemTier },
]

for (const { name, make } of tiers) {
  let t: WorkspaceTier

  describe(`Workspace [${name}]`, () => {
    afterEach(() => t?.dispose())

    it("readSync returns undefined for a missing repo-relative path", () => {
      t = make()
      const result = t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).readSync("missing.txt")
        }),
      )
      return expect(result).resolves.toBeUndefined()
    })

    it("readSync returns a present working-tree file's content", async () => {
      t = make()
      t.writeWorking("a.txt", "hello\n")
      const result = await t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).readSync("a.txt")
        }),
      )
      expect(result).toBe("hello\n")
    })

    it("read (the Effect shape) mirrors readSync — undefined for absence, content when present", async () => {
      t = make()
      t.writeWorking("a.txt", "hello\n")
      const [present, absent] = await t.provide(
        Effect.gen(function* () {
          const workspace = yield* Workspace
          return [yield* workspace.read("a.txt"), yield* workspace.read("missing.txt")]
        }),
      )
      expect(present).toBe("hello\n")
      expect(absent).toBeUndefined()
    })

    it("a non-ENOENT read failure still fails rather than reading as absent", async () => {
      t = make()
      t.writeWorking("adir/inside.txt", "x")
      const exit = await t
        .provide(
          Effect.gen(function* () {
            return (yield* Workspace).readSync("adir")
          }),
        )
        .then(
          (v) => ({ ok: true, v }) as const,
          (e) => ({ ok: false, e }) as const,
        )
      // The Live tier's `readSync("adir")` hits EISDIR — a genuine fault, not
      // absence. The InMemory tier models no directories, so this assertion
      // only bites for Live; skip it there via the tier name.
      if (name === "Live") {
        expect(exit.ok).toBe(false)
      }
    })

    it("committed reads a file's contents at a given ref, undefined when absent there", async () => {
      t = make()
      t.commit("a.txt", "committed\n")
      const [atHead, missing] = await t.provide(
        Effect.gen(function* () {
          const workspace = yield* Workspace
          return [yield* workspace.committed("a.txt"), yield* workspace.committed("missing.txt")]
        }),
      )
      expect(atHead).toBe("committed\n")
      expect(missing).toBeUndefined()
    })

    it("readCommittedSync reads a file's contents at a given ref, undefined when absent there — committed's synchronous twin, for replay", async () => {
      t = make()
      t.commit("a.txt", "committed\n")
      const [atHead, missing] = await t.provide(
        Effect.gen(function* () {
          const workspace = yield* Workspace
          return [workspace.readCommittedSync("a.txt"), workspace.readCommittedSync("missing.txt")]
        }),
      )
      expect(atHead).toBe("committed\n")
      expect(missing).toBeUndefined()
    })

    it("readCommittedSync is undefined for a path that's only in the working tree, never committed — the evidence rule's whole point", async () => {
      t = make()
      t.writeWorking("scratch.txt", "freshly gathered, ungoverned\n")
      const result = await t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).readCommittedSync("scratch.txt")
        }),
      )
      expect(result).toBeUndefined()
    })

    it("write then read round-trips a repo-relative path", async () => {
      t = make()
      const content = await t.provide(
        Effect.gen(function* () {
          const workspace = yield* Workspace
          yield* workspace.write("out.txt", "written\n")
          return yield* workspace.read("out.txt")
        }),
      )
      expect(content).toBe("written\n")
    })

    it("readSync rejects an absolute path — repo-relative only, atPath is the deliberate escape", () => {
      t = make()
      const attempt = t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).readSync(join(t.root, "outside-call.txt"))
        }),
      )
      return expect(attempt).rejects.toThrow(/repo-relative paths only/)
    })

    it("write rejects an absolute path the same way", async () => {
      t = make()
      const attempt = t.provide(
        Effect.gen(function* () {
          const workspace = yield* Workspace
          yield* workspace.write(join(t.root, "outside-write.txt"), "x")
        }),
      )
      await expect(attempt).rejects.toThrow(/repo-relative paths only/)
    })

    it("atPath reads an absolute path INSIDE root, the same content readSync's relative form sees", async () => {
      t = make()
      t.writeWorking("nested/a.txt", "inside\n")
      const content = await t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).atPath(join(t.root, "nested/a.txt"))
        }),
      )
      expect(content).toBe("inside\n")
    })

    it("writeAtPath writes an absolute path, readable back through atPath (gtd uncheck's own shape)", async () => {
      t = make()
      const content = await t.provide(
        Effect.gen(function* () {
          const workspace = yield* Workspace
          yield* workspace.writeAtPath(join(t.root, "written-abs.txt"), "abs\n")
          return workspace.atPath(join(t.root, "written-abs.txt"))
        }),
      )
      expect(content).toBe("abs\n")
    })
  })
}

describe("Workspace [Live] worktreeSync", () => {
  let root: string
  const git = (...args: string[]) => gitExecIn(root, ...args)
  const write = (path: string, content: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const ops = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* Workspace
      }).pipe(
        Effect.provide(
          Workspace.Live.pipe(
            Layer.provide(
              Layer.merge(
                Host.layer({ root, home: root, env: {} }),
                GitService.Live.pipe(
                  Layer.provide(
                    Layer.merge(Host.layer({ root, home: root, env: {} }), NodeContext.layer),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    )
  /** The tree `git add -A` would commit, read back through git itself. */
  const stagedTree = async (): Promise<ReadonlyMap<string, string>> => {
    git("add", "-A")
    const tree = git("write-tree")
    git("reset", "-q")
    return (await ops()).treeSync(tree)
  }

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const seed = () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-worktree-")))
    git("init", "-q")
    git("config", "user.email", "test@test.com")
    git("config", "user.name", "Test")
    git("config", "commit.gpgsign", "false")
    write(".gitattributes", "*.crlf text eol=crlf\n")
    write("notes.crlf", "one\ntwo\n")
    write("big.txt", "x".repeat(2 * 1024 * 1024))
    write("keep.txt", "keep\n")
    write("gone.txt", "gone\n")
    symlinkSync("keep.txt", join(root, "link"))
    const sub = join(root, "sub")
    mkdirSync(sub)
    gitExecIn(sub, "init", "-q")
    writeFileSync(join(sub, "s.txt"), "s\n")
    gitExecIn(sub, "add", "-A")
    gitExecIn(sub, "-c", "user.email=t@t", "-c", "user.name=T", "commit", "-q", "-m", "s")
    git("add", "-A")
    git("commit", "-q", "-m", "init")
  }

  it("a clean working tree maps every committed path to HEAD's blob id — eol, symlink, large file and submodule alike", async () => {
    seed()
    rmSync(join(root, "notes.crlf"))
    git("checkout", "--", "notes.crlf")
    const workspace = await ops()
    expect(workspace.worktreeSync()).toEqual(workspace.treeSync("HEAD"))
  })

  it("a dirty working tree maps to exactly the tree `git add -A` would commit", async () => {
    seed()
    write("keep.txt", "changed\n")
    write("notes.crlf", "one\ntwo\nthree\n")
    write("new/added.txt", "added\n")
    write("new/line\nbreak.txt", "a newline in its name\n")
    rmSync(join(root, "gone.txt"))
    symlinkSync("big.txt", join(root, "link2"))
    const sub = join(root, "sub")
    writeFileSync(join(sub, "s.txt"), "s2\n")
    gitExecIn(sub, "-c", "user.email=t@t", "-c", "user.name=T", "commit", "-q", "-am", "s2")
    const actual = (await ops()).worktreeSync()
    expect(actual).toEqual(await stagedTree())
  })

  it("readCommittedSync reads a committed file larger than execFileSync's default buffer", async () => {
    seed()
    expect((await ops()).readCommittedSync("big.txt")?.length).toBe(2 * 1024 * 1024)
  })
})

// ── episodeTrees ──────────────────────────────────────────────────────────

/** A minimal `Workspace [Live]` fixture, giving direct git access for seeding. */
const makeLiveEpisodeTier = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-episode-tier-")))
  // Array-args `execFileSync`, never a shell-joined string: a commit message
  // with spaces (every message below has one) would otherwise be split into
  // extra pathspec arguments by `gitExecIn`'s naive `join(" ")`.
  const git = (...args: string[]): string =>
    childProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  git("init", "-q")
  git("config", "user.email", "test@test.com")
  git("config", "user.name", "Test")
  git("config", "commit.gpgsign", "false")

  const hostLayer = Host.layer({ root, home: root, env: {} })
  const gitLayer = GitService.Live.pipe(Layer.provide(Layer.merge(hostLayer, NodeContext.layer)))
  const workspaceLayer = Workspace.Live.pipe(Layer.provide(Layer.merge(hostLayer, gitLayer)))
  const ops = (): Promise<WorkspaceOps> =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* Workspace
      }).pipe(Effect.provide(workspaceLayer)),
    )

  const write = (path: string, content: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const commit = (message: string): string => {
    git("add", "-A")
    git("commit", "-q", "-m", message)
    return git("rev-parse", "HEAD")
  }

  return {
    root,
    git,
    write,
    commit,
    ops,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

describe("Workspace [Live] episodeTrees", () => {
  let t: ReturnType<typeof makeLiveEpisodeTier>
  afterEach(() => t?.dispose())

  it("reconstructs every commit's tree in an episode exactly like `git ls-tree` itself — mode-only change, deletion, rename, gitlink, and a merge commit on the first-parent path", async () => {
    t = makeLiveEpisodeTier()
    t.write("keep.txt", "keep\n")
    t.write("mode.txt", "mode\n")
    t.write("gone.txt", "gone\n")
    t.write("old-name.txt", "renamed content\n")
    const base = t.commit("base")

    // c1: a mode-only change (chmod +x, no content change).
    childProcess.execFileSync("chmod", ["+x", join(t.root, "mode.txt")])
    const c1 = t.commit("c1: chmod +x mode.txt")

    // c2: a deletion.
    rmSync(join(t.root, "gone.txt"))
    const c2 = t.commit("c2: delete gone.txt")

    // c3: a rename.
    childProcess.execFileSync("git", ["mv", "old-name.txt", "new-name.txt"], { cwd: t.root })
    const c3 = t.commit("c3: rename old-name.txt to new-name.txt")

    // c4: a gitlink (an embedded repository).
    const sub = join(t.root, "sub")
    mkdirSync(sub)
    gitExecIn(sub, "init", "-q")
    writeFileSync(join(sub, "s.txt"), "s\n")
    gitExecIn(sub, "add", "-A")
    gitExecIn(sub, "-c", "user.email=t@t", "-c", "user.name=T", "commit", "-q", "-m", "s")
    const c4 = t.commit("c4: add submodule")

    // c5: a merge commit — first-parent diff carries the feature branch's own addition.
    t.git("checkout", "-q", "-b", "feature")
    t.write("feature.txt", "feature\n")
    t.commit("feature: add feature.txt")
    t.git("checkout", "-q", "-")
    t.git("merge", "-q", "--no-ff", "-m", "c5: merge feature", "feature")
    const c5 = t.git("rev-parse", "HEAD")

    const workspace = await t.ops()
    const commits = [c1, c2, c3, c4, c5]
    const result = await Effect.runPromise(workspace.episodeTrees(base, commits))

    expect(result.get(base)).toEqual(workspace.treeSync(base))
    for (const hash of commits) {
      expect(result.get(hash), `mismatch at ${hash}`).toEqual(workspace.treeSync(hash))
    }
    // Sanity: the reconstruction actually exercised every kind of change,
    // not just carried the base tree forward unchanged.
    expect(result.get(c2)!.has("gone.txt")).toBe(false)
    expect(result.get(c3)!.has("old-name.txt")).toBe(false)
    expect(result.get(c3)!.has("new-name.txt")).toBe(true)
    expect(result.get(c4)!.get("sub")).toBeDefined()
    expect(result.get(c5)!.has("feature.txt")).toBe(true)
  })

  it("works for an episode starting at the repository's root commit, with the empty tree as its base", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const c1 = t.commit("c1: root commit")
    t.write("b.txt", "b\n")
    const c2 = t.commit("c2: second commit")

    const workspace = await t.ops()
    const result = await Effect.runPromise(workspace.episodeTrees(undefined, [c1, c2]))
    expect(result.get(c1)).toEqual(workspace.treeSync(c1))
    expect(result.get(c2)).toEqual(workspace.treeSync(c2))
  })

  it("issues exactly two git subprocesses for a cold-cache episode — one ls-tree, one log --raw — regardless of episode length", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    const commits: string[] = []
    for (let i = 0; i < 8; i++) {
      t.write(`file-${i}.txt`, `${i}\n`)
      commits.push(t.commit(`c${i}`))
    }
    const workspace = await t.ops()
    execFileSyncSpy.mockClear()
    const result = await Effect.runPromise(workspace.episodeTrees(base, commits))
    expect(result.size).toBe(commits.length + 1)
    const gitCalls = execFileSyncSpy.mock.calls.filter(([cmd]) => cmd === "git")
    const lsTreeCalls = gitCalls.filter(([, args]) => (args as string[]).includes("ls-tree"))
    const logCalls = gitCalls.filter(([, args]) => (args as string[])[0] === "log")
    expect(lsTreeCalls.length).toBe(1)
    expect(logCalls.length).toBe(1)
  })

  it("reads full, unabbreviated ids off the raw diff — an abbreviated id would misread as a modification against ls-tree's own full one on every path", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    t.write("b.txt", "b\n")
    const c1 = t.commit("c1: add b.txt")
    const workspace = await t.ops()
    const result = await Effect.runPromise(workspace.episodeTrees(base, [c1]))
    const expectedLength = workspace.treeSync(c1).get("a.txt")!.length
    expect(expectedLength).toBeGreaterThanOrEqual(40)
    // `a.txt` is untouched by c1 — its id must equal the base's byte-for-byte
    // AND be full-length, never an abbreviated prefix `git log --raw`
    // defaults to without `--no-abbrev`.
    expect(result.get(c1)!.get("a.txt")).toBe(workspace.treeSync(base).get("a.txt"))
    expect(result.get(c1)!.get("a.txt")!.length).toBe(expectedLength)
    expect(result.get(c1)!.get("b.txt")!.length).toBe(expectedLength)
  })

  it("issues NO subprocess at all once every requested hash is already cached", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    t.write("b.txt", "b\n")
    const c1 = t.commit("c1")
    const workspace = await t.ops()
    await Effect.runPromise(workspace.episodeTrees(base, [c1])) // warms the cache
    execFileSyncSpy.mockClear()
    const result = await Effect.runPromise(workspace.episodeTrees(base, [c1]))
    expect(result.get(c1)).toEqual(workspace.treeSync(c1))
    expect(execFileSyncSpy.mock.calls.filter(([cmd]) => cmd === "git")).toEqual([])
  })

  it("caches on disk under the git COMMON directory (`gtd-cache/`), surviving a brand-new Workspace instance", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    t.write("b.txt", "b\n")
    const c1 = t.commit("c1")
    const first = await t.ops()
    await Effect.runPromise(first.episodeTrees(base, [c1]))
    const cacheFile = join(t.root, ".git", "gtd-cache", "trees", c1)
    expect(readFileSync(cacheFile, "utf8").length).toBeGreaterThan(0)

    // A second, independent Workspace instance (a fresh process would build
    // one just like this) reads the same commit with zero subprocesses.
    const second = await t.ops()
    execFileSyncSpy.mockClear()
    const result = await Effect.runPromise(second.episodeTrees(base, [c1]))
    expect(result.get(c1)).toEqual(
      new Map(Object.entries(JSON.parse(readFileSync(cacheFile, "utf8")))),
    )
    expect(execFileSyncSpy.mock.calls.filter(([cmd]) => cmd === "git")).toEqual([])
  })

  it("a corrupted cache file is treated as a miss, falling back to git rather than surfacing an error", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    t.write("b.txt", "b\n")
    const c1 = t.commit("c1")
    const workspace = await t.ops()
    await Effect.runPromise(workspace.episodeTrees(base, [c1]))
    const cacheFile = join(t.root, ".git", "gtd-cache", "trees", c1)
    writeFileSync(cacheFile, "{ not json")

    const fresh = await t.ops()
    const result = await Effect.runPromise(fresh.episodeTrees(base, [c1]))
    expect(result.get(c1)).toEqual(
      new Map([
        ["a.txt", fresh.treeSync(base).get("a.txt")!],
        ["b.txt", fresh.treeSync(c1).get("b.txt")!],
      ]),
    )
  })

  it("deleting the cache directory mid-run is safe: the next read falls back to git", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    t.write("b.txt", "b\n")
    const c1 = t.commit("c1")
    const workspace = await t.ops()
    await Effect.runPromise(workspace.episodeTrees(base, [c1]))
    rmSync(join(t.root, ".git", "gtd-cache"), { recursive: true, force: true })

    const fresh = await t.ops()
    const result = await Effect.runPromise(fresh.episodeTrees(base, [c1]))
    expect(result.get(c1)).toEqual(fresh.treeSync(c1))
  })

  it("two processes writing the same key concurrently leave a readable file and neither fails", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    t.write("b.txt", "b\n")
    const c1 = t.commit("c1")
    const [a, b] = await Promise.all([t.ops(), t.ops()])
    const [resultA, resultB] = await Promise.all([
      Effect.runPromise(a.episodeTrees(base, [c1])),
      Effect.runPromise(b.episodeTrees(base, [c1])),
    ])
    expect(resultA.get(c1)).toEqual(resultB.get(c1))
    const cacheFile = join(t.root, ".git", "gtd-cache", "trees", c1)
    expect(() => JSON.parse(readFileSync(cacheFile, "utf8"))).not.toThrow()
  })

  it("a transient `ls-tree` failure on the base is never cached — the episode fails loudly instead of poisoning every commit's tree with a wrong empty base", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    t.write("b.txt", "b\n")
    const c1 = t.commit("c1")
    const workspace = await t.ops()

    execFileSyncSpy.mockImplementationOnce(() => {
      throw new Error("simulated transient ls-tree failure (EAGAIN/ENOMEM/signal)")
    })
    await expect(Effect.runPromise(workspace.episodeTrees(base, [c1]))).rejects.toThrow()

    const baseCacheFile = join(t.root, ".git", "gtd-cache", "trees", base)
    const c1CacheFile = join(t.root, ".git", "gtd-cache", "trees", c1)
    expect(() => readFileSync(baseCacheFile, "utf8")).toThrow()
    expect(() => readFileSync(c1CacheFile, "utf8")).toThrow()

    // A clean retry succeeds and caches the correct (non-empty) trees.
    const result = await Effect.runPromise(workspace.episodeTrees(base, [c1]))
    expect(result.get(base)!.get("a.txt")).toBeDefined()
    expect(result.get(c1)!.get("a.txt")).toBeDefined()
    expect(result.get(c1)!.get("b.txt")).toBeDefined()
  })

  it("`treeSync`'s own transient `ls-tree` failure is never cached, unlike a git-confirmed empty tree", async () => {
    t = makeLiveEpisodeTier()
    t.write("a.txt", "a\n")
    const base = t.commit("base")
    const workspace = await t.ops()
    const cacheFile = join(t.root, ".git", "gtd-cache", "trees", base)

    execFileSyncSpy.mockImplementationOnce(() => {
      throw new Error("simulated transient ls-tree failure")
    })
    expect(workspace.treeSync(base).size).toBe(0)
    expect(() => readFileSync(cacheFile, "utf8")).toThrow()

    // The next (unmocked) call actually asks git, succeeds, and THIS result
    // — git-confirmed, not folded-from-a-failure — is what gets cached.
    expect(workspace.treeSync(base).get("a.txt")).toBeDefined()
    expect(readFileSync(cacheFile, "utf8").length).toBeGreaterThan(0)
  })
})

describe("Workspace [Live] blob-id read cache", () => {
  let t: ReturnType<typeof makeLiveEpisodeTier>
  afterEach(() => t?.dispose())

  it("reads the same content across two commits once — commitTree-style access via readCommittedSync never spawns git show twice for the same blob id", async () => {
    t = makeLiveEpisodeTier()
    t.write("shared.txt", "unchanged across both commits\n")
    const c1 = t.commit("c1")
    t.write("other.txt", "irrelevant change\n")
    const c2 = t.commit("c2")
    const workspace = await t.ops()

    const first = workspace.readCommittedSync("shared.txt", c1)
    execFileSyncSpy.mockClear()
    const second = workspace.readCommittedSync("shared.txt", c2)
    expect(second).toBe(first)
    // The tree for c2 must be read (a new commit), but no second blob read
    // for the identical content `shared.txt` carries at both commits.
    const catFileCalls = execFileSyncSpy.mock.calls.filter(
      ([cmd, args]) => cmd === "git" && (args as string[])[0] === "cat-file",
    )
    expect(catFileCalls.length).toBe(0)
  })

  it("caches blob content on disk, keyed by blob id, under gtd-cache/blobs/", async () => {
    t = makeLiveEpisodeTier()
    t.write("shared.txt", "cached content\n")
    const c1 = t.commit("c1")
    const workspace = await t.ops()
    const id = workspace.treeSync(c1).get("shared.txt")!
    workspace.readCommittedSync("shared.txt", c1)
    const cacheFile = join(t.root, ".git", "gtd-cache", "blobs", id)
    expect(readFileSync(cacheFile, "utf8")).toBe("cached content\n")
  })
})
