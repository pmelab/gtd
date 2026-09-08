import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { NodeContext } from "@effect/platform-node"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createShim, ownGtdBinary, shimScript } from "./Shim.js"

const run = promisify(execFile)

let tmpDir: string
let worktreeDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-shim-test-"))
  worktreeDir = mkdtempSync(join(tmpdir(), "gtd-shim-worktree-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  rmSync(worktreeDir, { recursive: true, force: true })
})

describe("shimScript", () => {
  it("execs the exact target, with its own args then argv passed through verbatim", () => {
    const script = shimScript({ exec: "/usr/bin/node", args: ["/opt/gtd/dist/gtd.bundle.mjs"] })
    expect(script).toBe("#!/bin/sh\nexec '/usr/bin/node' '/opt/gtd/dist/gtd.bundle.mjs' \"$@\"\n")
  })

  it("a directly-executable target (no leading args) execs just that one path", () => {
    const script = shimScript({ exec: "/repo/node_modules/.bin/gtd", args: [] })
    expect(script).toBe("#!/bin/sh\nexec '/repo/node_modules/.bin/gtd' \"$@\"\n")
  })

  it("escapes an embedded single quote in either the exec or an arg", () => {
    const script = shimScript({ exec: "/it's/node", args: ["/x"] })
    expect(script).toContain("'/it'\\''s/node'")
  })
})

describe("ownGtdBinary", () => {
  it("reports this process's own execPath and invoked script as a node+script target", () => {
    const target = ownGtdBinary()
    expect(target.exec).toBe(process.execPath)
    expect(target.args).toEqual([process.argv[1] ?? ""])
  })
})

describe("createShim", () => {
  it("writes an executable gtd file into a fresh temp directory", async () => {
    const dir = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* createShim(fs, worktreeDir, { exec: "/usr/bin/node", args: ["/opt/x.mjs"] })
      }).pipe(Effect.provide(NodeContext.layer)),
    )
    const mode = statSync(join(dir, "gtd")).mode
    expect(mode & 0o111).toBeTruthy()
  })

  it("a bare `gtd` on PATH inside the shim resolves and runs a real script, when the worktree has no local install", async () => {
    const fakeGtd = join(tmpDir, "fake-gtd.mjs")
    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(
          fakeGtd,
          "console.log('args:' + process.argv.slice(2).join(','))\n",
        )
      }).pipe(Effect.provide(NodeContext.layer)),
    )
    const shimDir = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* createShim(fs, worktreeDir, {
          exec: process.execPath,
          args: [fakeGtd],
        })
      }).pipe(Effect.provide(NodeContext.layer)),
    )

    const { stdout } = await run("bash", ["-c", "gtd check qa 'a file.md'"], {
      env: { ...process.env, PATH: `${shimDir}:${process.env["PATH"] ?? ""}` },
    })
    expect(stdout.trim()).toBe("args:check,qa,a file.md")
  })

  it("resolves to the WORKTREE's own node_modules/.bin/gtd when it exists, never the fallback", async () => {
    const localBinDir = join(worktreeDir, "node_modules/.bin")
    mkdirSync(localBinDir, { recursive: true })
    const localGtd = join(localBinDir, "gtd")
    writeFileSync(localGtd, '#!/bin/sh\necho "local-gtd:$*"\n', { mode: 0o755 })

    const shimDir = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        // A fallback that would produce visibly different output if it were
        // ever reached — proves the local install actually won, not just
        // that SOME shim was written.
        return yield* createShim(fs, worktreeDir, {
          exec: "/bin/echo",
          args: ["fallback-reached"],
        })
      }).pipe(Effect.provide(NodeContext.layer)),
    )

    const { stdout } = await run("bash", ["-c", "gtd next --json"], {
      env: { ...process.env, PATH: `${shimDir}:${process.env["PATH"] ?? ""}` },
    })
    expect(stdout.trim()).toBe("local-gtd:next --json")
  })

  it("falls back when the worktree has a node_modules but no .bin/gtd of its own", async () => {
    mkdirSync(join(worktreeDir, "node_modules"), { recursive: true })
    const shimDir = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* createShim(fs, worktreeDir, { exec: "/bin/echo", args: ["fallback"] })
      }).pipe(Effect.provide(NodeContext.layer)),
    )
    const { stdout } = await run("bash", ["-c", "gtd x"], {
      env: { ...process.env, PATH: `${shimDir}:${process.env["PATH"] ?? ""}` },
    })
    expect(stdout.trim()).toBe("fallback x")
  })

  it("uses ownGtdBinary() as the default fallback when none is given", async () => {
    const dir = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* createShim(fs, worktreeDir)
      }).pipe(Effect.provide(NodeContext.layer)),
    )
    const own = ownGtdBinary()
    const content = statSync(join(dir, "gtd"))
    expect(content.mode & 0o111).toBeTruthy()
    const { readFileSync } = await import("node:fs")
    expect(readFileSync(join(dir, "gtd"), "utf8")).toBe(shimScript(own))
  })

  it("two calls create two distinct directories, with no crosstalk", async () => {
    const [a, b] = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const first = yield* createShim(fs, worktreeDir, { exec: "/bin/echo", args: [] })
        const second = yield* createShim(fs, worktreeDir, { exec: "/bin/echo", args: [] })
        return [first, second] as const
      }).pipe(Effect.provide(NodeContext.layer)),
    )
    expect(a).not.toBe(b)
    expect(statSync(join(a, "gtd")).mode & 0o111).toBeTruthy()
    expect(statSync(join(b, "gtd")).mode & 0o111).toBeTruthy()
  })
})
