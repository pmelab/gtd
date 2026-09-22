import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GitService, Host, Workspace } from "./index.js"
import { InMemRepo, makeInMemoryWorkspaceOps } from "../testing/index.js"

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

    it("readCommittedSync reads a file's contents at a given ref, undefined when absent there — committed's synchronous twin, for judge:'s Eta render", async () => {
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

    it("diffSync carries a tracked modification's own hunk", async () => {
      t = make()
      t.commit("a.txt", "one\n")
      t.writeWorking("a.txt", "two\n")
      const diff = await t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).diffSync("HEAD")
        }),
      )
      expect(diff).toContain("a.txt")
      expect(diff).toContain("-one")
      expect(diff).toContain("+two")
    })

    it("diffSync carries an UNTRACKED, never-added file's own content as a real hunk — git diff alone would miss it entirely", async () => {
      t = make()
      t.commit("committed.txt", "seed\n")
      t.writeWorking("brand-new.txt", "never added\n")
      const diff = await t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).diffSync("HEAD")
        }),
      )
      expect(diff).toContain("brand-new.txt")
      expect(diff).toContain("+never added")
    })

    it("diffSync leaves the repository's real index and git status byte-identical — the untracked file stays ??", async () => {
      t = make()
      if (name !== "Live") return
      t.commit("committed.txt", "seed\n")
      t.writeWorking("brand-new.txt", "never added\n")
      const statusBefore = gitExecIn(t.root, "status", "--porcelain")
      await t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).diffSync("HEAD")
        }),
      )
      const statusAfter = gitExecIn(t.root, "status", "--porcelain")
      expect(statusAfter).toBe(statusBefore)
      expect(statusAfter).toContain("?? brand-new.txt")
    })

    it("diffSync omits a .gitignore'd file entirely", async () => {
      t = make()
      if (name !== "Live") return
      t.commit(".gitignore", "ignored.txt\n")
      t.writeWorking("ignored.txt", "should never appear\n")
      const diff = await t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).diffSync("HEAD")
        }),
      )
      expect(diff).not.toContain("ignored.txt")
    })

    it("diffSync throws for a base that doesn't resolve, rather than falling back to a tracked-only diff", async () => {
      t = make()
      if (name !== "Live") return
      t.commit("a.txt", "one\n")
      const attempt = t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).diffSync("not-a-real-ref")
        }),
      )
      await expect(attempt).rejects.toThrow()
    })

    it("diffSync returns a diff well past Node's default 1 MB execFileSync buffer, rather than throwing ENOBUFS", async () => {
      t = make()
      if (name !== "Live") return
      t.commit("seed.txt", "seed\n")
      // A single-file change past 1 MB — Node's execFileSync default
      // maxBuffer — reproduces the ENOBUFS a missing `maxBuffer` option
      // throws (`spec-review` finding: build.review.pre could never render
      // past this size).
      const big = "x".repeat(1_400_000)
      t.writeWorking("big.txt", big)
      const diff = await t.provide(
        Effect.gen(function* () {
          return (yield* Workspace).diffSync("HEAD")
        }),
      )
      expect(diff).toContain("big.txt")
      expect(diff.length).toBeGreaterThan(1_000_000)
    })

    // Racy-index pin. `copyFileSync` alone gives the throwaway index a FRESH
    // mtime; git treats an entry as "racily clean" (must re-read content
    // rather than trust a cached stat match) exactly when the entry's own
    // recorded mtime is >= the index FILE's mtime — a fresh copy mtime
    // un-races entries that were racy against the REAL index, so a
    // same-tick edit can silently vanish from the diff. This can't be
    // forced deterministically with `utimesSync`: forging an mtime back to
    // an earlier value also changes the file's `ctime` (metadata-change
    // time, unforgeable without root), which then no longer matches the
    // cached entry either, so git re-reads content anyway and the forced
    // setup never reproduces the bug — confirmed empirically against both
    // the buggy and the fixed code path while diagnosing this pin. The
    // window only exists for a GENUINE same-tick commit-then-edit, so this
    // asserts across many real ones instead: unfixed, this fails within
    // ~100 iterations (~1-3% per iteration, reproduced directly against a
    // real repo while diagnosing `.gtd/packages/03-judgment-inlines-its-evidence.md`);
    // fixed (the real index's own mtime preserved on the copy), 0 failures
    // in 150+ iterations.
    it("diffSync never silently drops a tracked edit made in the same tick as the commit that preceded it, across many real commit-then-edit cycles", async () => {
      t = make()
      if (name !== "Live") return
      const ITERATIONS = 150
      // Fixed-width content (always 5 bytes) so a genuine content change
      // never coincides with a size change — the one condition that would
      // let a plain stat check catch the edit without racy protection ever
      // being relevant, defeating the pin. Committed content varies by `i`
      // (else the 2nd+ commit is a same-content no-op, "nothing to
      // commit"); the uncommitted edit is a fixed marker, same width.
      for (let i = 0; i < ITERATIONS; i++) {
        t.commit("a.txt", `${String(i).padStart(4, "0")}\n`)
        t.writeWorking("a.txt", "zzzz\n")
        // eslint-disable-next-line no-await-in-loop -- each iteration's
        // repo state (the just-made commit) must exist before the next.
        const diff = await t.provide(
          Effect.gen(function* () {
            return (yield* Workspace).diffSync("HEAD")
          }),
        )
        expect(diff, `iteration ${i}`).toContain("a.txt")
        expect(diff, `iteration ${i}`).toContain("+zzzz")
      }
    }, 120_000)
  })
}
