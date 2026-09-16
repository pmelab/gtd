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
