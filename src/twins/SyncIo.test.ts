import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { nodeSyncIo, type SyncIo } from "../platform/index.js"
import { InMemRepo, inMemorySyncIo } from "./index.js"

interface Tier {
  readonly io: SyncIo
  /** A git repository, empty until `commit`. */
  readonly root: string
  readonly uid: number | undefined
  readonly symlink: (path: string, target: string) => void
  /** Commits `files`, repository-relative, as the only change. */
  readonly commit: (files: Record<string, string>) => void
}

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

const liveTier = (): Tier => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-sync-io-")))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
  git("init", "-q")
  return {
    io: nodeSyncIo,
    root,
    uid: process.getuid?.(),
    symlink: (path, target) => symlinkSync(target, path),
    commit: (files) => {
      for (const [path, content] of Object.entries(files))
        nodeSyncIo.writeText(join(root, path), content)
      git("add", "-A")
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "c")
    },
  }
}

const inMemTier = (): Tier => {
  const repo = new InMemRepo()
  const root = "/repo"
  const io = inMemorySyncIo({ repo, root, uid: 501 })
  io.makeDirectory(root)
  return {
    io,
    root,
    uid: 501,
    symlink: io.symlink,
    commit: (files) => {
      for (const [path, content] of Object.entries(files)) {
        io.writeText(`${root}/${path}`, content)
        repo.writeFile(path, content)
      }
      repo.seedCommit("c")
    },
  }
}

describe.each([
  ["live", liveTier],
  ["in memory", inMemTier],
])("SyncIo (%s)", (_, makeTier) => {
  it("reads absence as a value and a directory as a fault", () => {
    const { io, root } = makeTier()
    io.writeText(`${root}/file`, "x")

    expect(io.readText(`${root}/missing`)).toBeUndefined()
    expect(io.readFile(`${root}/file/below`)).toBeUndefined()
    expect(() => io.readText(root)).toThrow()
  })

  it("writes text and reads it back as text and bytes", () => {
    const { io, root } = makeTier()
    io.makeDirectory(`${root}/a/b`)
    io.makeDirectory(`${root}/a/b`)
    io.writeText(`${root}/a/b/f`, "\uFEFFhéllo")

    expect(io.readText(`${root}/a/b/f`)).toBe("\uFEFFhéllo")
    expect(new Uint8Array(io.readFile(`${root}/a/b/f`)!)).toEqual(
      new TextEncoder().encode("\uFEFFhéllo"),
    )
    expect(() => io.writeText(`${root}/none/f`, "x")).toThrow()
  })

  it("renames a file over another, and over a symlink rather than through it", () => {
    const { io, root, symlink } = makeTier()
    io.writeText(`${root}/from`, "new")
    io.writeText(`${root}/to`, "old")
    io.rename(`${root}/from`, `${root}/to`)
    io.writeText(`${root}/other`, "moved")
    symlink(`${root}/link`, "to")
    io.rename(`${root}/other`, `${root}/link`)

    expect(io.readText(`${root}/from`)).toBeUndefined()
    expect(io.readText(`${root}/to`)).toBe("new")
    expect(io.lstat(`${root}/link`)?.type).toBe("file")
    expect(io.readText(`${root}/link`)).toBe("moved")
  })

  it("stats through a symlink, lstats the link itself, and resolves real paths", () => {
    const { io, root, uid, symlink } = makeTier()
    io.makeDirectory(`${root}/dir`)
    io.writeText(`${root}/dir/f`, "x")
    symlink(`${root}/link`, "dir")
    symlink(`${root}/dangling`, "nowhere")

    expect(io.stat(`${root}/dir/f`)).toEqual({ type: "file", uid })
    expect(io.stat(`${root}/link`)).toEqual({ type: "directory", uid })
    expect(io.lstat(`${root}/link`)).toEqual({ type: "symlink", uid })
    expect(io.lstat(`${root}/missing`)).toBeUndefined()
    expect(io.stat(`${root}/dangling`)).toBeUndefined()
    expect(io.readLink(`${root}/link`)).toBe("dir")
    expect(io.realPath(`${root}/link/f`)).toBe(`${root}/dir/f`)
    expect(io.readText(`${root}/link/f`)).toBe("x")
    expect(() => io.realPath(`${root}/dangling`)).toThrow()
  })

  it("reads committed content through git", () => {
    const { io, root, commit } = makeTier()
    commit({ "a.txt": "committed\n" })

    expect(io.git(root, ["show", "HEAD:a.txt"])).toBe("committed\n")
    expect(new Uint8Array(io.gitBytes(root, ["show", "HEAD:a.txt"]))).toEqual(
      new TextEncoder().encode("committed\n"),
    )
    expect(io.git(root, ["rev-parse", "--show-object-format"])).toBe("sha1\n")
    expect(io.git(root, ["rev-parse", "HEAD"])).toMatch(/^[0-9a-f]{40}\n$/)
    expect(() => io.git(root, ["show", "HEAD:missing"])).toThrow()
    expect(() => io.gitBytes(root, ["show", "HEAD:missing"])).toThrow()
  })

  it("hashes like git and the standard test vectors", () => {
    const { io } = makeTier()
    const million = "a".repeat(1_000_000)

    expect(io.hash("sha1", "blob 5\0", new TextEncoder().encode("hello"))).toBe(
      "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0",
    )
    expect(io.hash("sha1", "")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709")
    expect(io.hash("sha1", million)).toBe("34aa973cd4c4daa4f61eeb2bdbad27316534016f")
    expect(io.hash("sha256", "abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
    expect(io.hash("sha256", "a".repeat(55), "a".repeat(9))).toBe(
      "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
    )
    expect(io.hash("sha256", million)).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    )
  })
})
