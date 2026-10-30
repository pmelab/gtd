import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { livePinFile, type PinFile } from "../platform/index.js"
import { InMemRepo } from "./index.js"
import { inMemPinFile } from "./PinFile.js"

const PIN = ".gtd/process.gtdpin"

interface Tier {
  readonly root: string
  /** The pin a launcher starting at the root finds. */
  readonly pinFile: () => PinFile
  readonly write: (path: string, content: string) => void
  readonly remove: (path: string) => void
  readonly commit: () => void
}

const liveTier = (): Tier => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-pinfile-")))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
  git("init", "-q")
  return {
    root,
    pinFile: () => livePinFile(root, PIN),
    write: (path, content) => {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    },
    remove: (path) => rmSync(join(root, path)),
    commit: () => {
      git("add", "-A")
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c")
    },
  }
}

const inMemTier = (): Tier => {
  const repo = new InMemRepo()
  const root = "/repo"
  return {
    root,
    pinFile: () => inMemPinFile(repo, root, PIN),
    write: (path, content) => repo.writeFile(path, content),
    remove: (path) => repo.deleteFile(path),
    commit: () => repo.seedCommit("c"),
  }
}

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const text = (pinFile: PinFile) => {
  const found = pinFile()
  return found && { path: found.path, content: Buffer.from(found.bytes).toString() }
}

describe.each([
  ["live", liveTier],
  ["in-memory", inMemTier],
])("PinFile contract: %s", (_, make) => {
  it("finds nothing without a pin", () => {
    const tier = make()
    tier.write("README.md", "x")
    tier.commit()
    expect(text(tier.pinFile())).toBeUndefined()
  })

  it("finds the worktree's pin, committed or not", () => {
    const tier = make()
    tier.write(PIN, "pinned")
    expect(text(tier.pinFile())).toEqual({ path: join(tier.root, PIN), content: "pinned" })
  })

  it("prefers the worktree's pin over HEAD's", () => {
    const tier = make()
    tier.write(PIN, "committed")
    tier.commit()
    tier.write(PIN, "rewritten")
    expect(text(tier.pinFile())?.content).toBe("rewritten")
  })

  it("falls back to HEAD's pin once the worktree's is deleted", () => {
    const tier = make()
    tier.write(PIN, "committed")
    tier.commit()
    tier.remove(PIN)
    expect(text(tier.pinFile())).toEqual({ path: join(tier.root, PIN), content: "committed" })
  })
})

describe("livePinFile", () => {
  it("reads an unreadable pin as no pin's bytes", () => {
    const tier = liveTier()
    tier.write(`${PIN}/inside`, "x")
    expect(text(tier.pinFile())).toEqual({ path: join(tier.root, PIN), content: "" })
  })

  it("finds nothing outside a repository", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "gtd-pinfile-")))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    expect(livePinFile(dir, PIN)()).toBeUndefined()
  })
})
