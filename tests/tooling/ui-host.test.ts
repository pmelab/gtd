import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { runCli } from "../../src/cli/index.js"
import { applyEmittedScript, InMemRepo, makeCapturingCliIo } from "../../src/twins/index.js"
import { liveUiHost, UiHost, type UiHostOps } from "../../src/ui/index.js"
import { inMemoryUiHost } from "../integration/support/ui-host.js"

// What `gtd ui` reaches outside its process, live and in memory, held to the
// same answers — what lets every `gtd ui` scenario but the real-process ones
// run in-process.
const GTD_BIN = resolve(import.meta.dirname, "../../dist/gtd.bundle.mjs")

const FILES = {
  "gtd.config.ts": [
    'import { agent, human } from "@pmelab/gtd/flows"',
    "export default async () => {",
    '  await human("idle", { message: "go", file: ".gtd/PLAN.md", mode: "qa" })',
    '  await agent("working", "work")',
    "}",
    "",
  ].join("\n"),
  ".gtd/PLAN.md": "the plan\n",
  "dir/inside.txt": "x\n",
}

interface Tier {
  readonly root: string
  readonly host: UiHostOps
  readonly head: () => string
  readonly dispose: () => void
}

const live = (): Tier => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-ui-host-")))
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
  git("init", "-q")
  git("config", "user.email", "t@t")
  git("config", "user.name", "t")
  git("config", "commit.gpgsign", "false")
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git("add", "-A")
  git("commit", "-q", "-m", "chore: initial commit")
  // The live host puts `<worktree>/node_modules/.bin` first on PATH.
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  writeFileSync(
    join(root, "node_modules/.bin/gtd"),
    `#!/bin/sh\nexec "${process.execPath}" "${GTD_BIN}" "$@"\n`,
    { mode: 0o755 },
  )
  return {
    root,
    host: Effect.runSync(Effect.provide(UiHost, liveUiHost)),
    head: () => git("rev-parse", "HEAD"),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

const inMemory = (): Tier => {
  const root = "/repo"
  const repo = new InMemRepo()
  for (const [path, content] of Object.entries(FILES)) repo.writeFile(path, content)
  repo.seedCommit("chore: initial commit")
  const gtd = async (...args: string[]) => {
    const { io, result } = makeCapturingCliIo(repo)
    await Effect.runPromise(runCli(["node", "gtd", ...args], io))
    return result()
  }
  const sh = async (script: string) => {
    const applied = applyEmittedScript(repo, new Map(), script)
    return { exitCode: applied.status, output: applied.output }
  }
  return {
    root,
    host: inMemoryUiHost(root, repo, { gtd, sh, serveRecords: new Map(), scratch: new Map() }),
    head: () => repo.resolveRef("HEAD")!,
    dispose: () => {},
  }
}

for (const make of [live, inMemory]) {
  describe(`UiHost [${make.name}]`, () => {
    let t: Tier
    afterEach(() => t.dispose())

    it("reads HEAD", async () => {
      t = make()
      expect(await t.host.headSha(t.root)).toBe(t.head())
    })

    it("reads a file, tells an absent one from a directory, and writes one with its directory", async () => {
      t = make()
      expect(await t.host.readFile(join(t.root, ".gtd/PLAN.md"))).toEqual({
        kind: "content",
        content: "the plan\n",
      })
      expect(await t.host.readFile(join(t.root, "missing.md"))).toEqual({ kind: "absent" })
      expect(await t.host.readFile(join(t.root, "dir"))).toEqual({ kind: "unreadable" })
      await t.host.writeFile(join(t.root, "new/deep/file.md"), "written\n")
      expect(await t.host.readFile(join(t.root, "new/deep/file.md"))).toEqual({
        kind: "content",
        content: "written\n",
      })
    })

    it("runs gtd in the worktree", async () => {
      t = make()
      const next = await t.host.run(t.root, "gtd next --json")
      expect(next.status).toBe(0)
      const rest = JSON.parse(next.stdout) as Record<string, unknown>
      expect([rest["state"], rest["actor"], rest["file"]]).toEqual([
        "idle",
        "human",
        ".gtd/PLAN.md",
      ])
    })

    it("reports no local gtd install as none", async () => {
      t = make()
      expect(await t.host.readLocalGtdVersion(t.root)).toBeUndefined()
    })

    it("reads a local gtd install's version, and none from a package that names none", async () => {
      t = make()
      const pkg = join(t.root, "node_modules/@pmelab/gtd/package.json")
      await t.host.writeFile(pkg, '{"name":"@pmelab/gtd","version":"9.1.0"}\n')
      expect(await t.host.readLocalGtdVersion(t.root)).toBe("9.1.0")
      await t.host.writeFile(pkg, '{"version":9}\n')
      expect(await t.host.readLocalGtdVersion(t.root)).toBeUndefined()
      await t.host.writeFile(pkg, "not json\n")
      expect(await t.host.readLocalGtdVersion(t.root)).toBeUndefined()
    })

    it("sees its own process alive", () => {
      t = make()
      expect(t.host.isPidAlive(process.pid)).toBe(true)
    })
  })
}
