import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { runCli } from "../../src/cli/index.js"
import { nodeLspIo, type LspIo } from "../../src/lsp/index.js"
import { InMemRepo, makeCapturingCliIo } from "../../src/testkit/index.js"
import { inMemoryLspIo } from "../integration/support/lsp-io.js"

// The LSP's git and gtd reads, live and in memory, held to the same answers
// for the same repository — what lets every LSP scenario but the stdio
// handshake run in-process.
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
}

interface Tier {
  readonly root: string
  readonly io: LspIo
  readonly head: () => string
  readonly commit: () => void
  readonly dispose: () => void
}

const live = (): Tier => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-lsp-io-")))
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
  mkdirSync(join(root, "sub"))
  git("add", "-A")
  git("commit", "-q", "-m", "chore: initial commit")
  return {
    root,
    io: nodeLspIo([process.execPath, GTD_BIN]),
    head: () => git("rev-parse", "HEAD"),
    commit: () => git("commit", "-q", "--allow-empty", "-m", "chore: second"),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

const inMemory = (): Tier => {
  const root = "/inmem"
  const repo = new InMemRepo()
  for (const [path, content] of Object.entries(FILES)) repo.writeFile(path, content)
  repo.seedCommit("chore: initial commit")
  const gtd = async (...args: string[]) => {
    const { io, result } = makeCapturingCliIo(repo)
    await Effect.runPromise(runCli(["node", "gtd", ...args], io))
    return result()
  }
  return {
    root,
    io: inMemoryLspIo(root, repo, gtd),
    head: () => repo.resolveRef("HEAD")!,
    commit: () => repo.seedCommit("chore: second"),
    dispose: () => {},
  }
}

for (const make of [live, inMemory]) {
  describe(`LspIo [${make.name}]`, () => {
    let t: Tier
    afterEach(() => t.dispose())

    it("finds the root from a subdirectory, and refuses outside a repository", async () => {
      t = make()
      expect(await t.io.topLevel(join(t.root, "sub"))).toBe(t.root)
      await expect(t.io.topLevel(tmpdir())).rejects.toThrow()
    })

    it("reads HEAD as it moves", async () => {
      t = make()
      expect(await t.io.head(t.root)).toBe(t.head())
      t.commit()
      expect(await t.io.head(t.root)).toBe(t.head())
    })

    it("reads the rest's steering file and mode off gtd next --json", async () => {
      t = make()
      const rest = JSON.parse(await t.io.next(t.root)) as Record<string, unknown>
      expect([rest["state"], rest["file"], rest["mode"]]).toEqual(["idle", ".gtd/PLAN.md", "qa"])
    })
  })
}
