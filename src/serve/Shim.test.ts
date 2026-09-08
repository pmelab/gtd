import { execFile } from "node:child_process"
import { mkdtempSync, rmSync, statSync } from "node:fs"
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-shim-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("shimScript", () => {
  it("execs the exact captured binary, with argv passed through verbatim", () => {
    const script = shimScript({ exec: "/usr/bin/node", script: "/opt/gtd/dist/gtd.bundle.mjs" })
    expect(script).toBe("#!/bin/sh\nexec '/usr/bin/node' '/opt/gtd/dist/gtd.bundle.mjs' \"$@\"\n")
  })

  it("escapes an embedded single quote in either path", () => {
    const script = shimScript({ exec: "/it's/node", script: "/x" })
    expect(script).toContain("'/it'\\''s/node'")
  })
})

describe("ownGtdBinary", () => {
  it("reports this process's own execPath and invoked script", () => {
    const binary = ownGtdBinary()
    expect(binary.exec).toBe(process.execPath)
    expect(binary.script).toBe(process.argv[1] ?? "")
  })
})

describe("createShim", () => {
  it("writes an executable gtd file into a fresh temp directory", async () => {
    const dir = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* createShim(fs, { exec: "/usr/bin/node", script: "/opt/gtd/gtd.mjs" })
      }).pipe(Effect.provide(NodeContext.layer)),
    )
    const mode = statSync(join(dir, "gtd")).mode
    expect(mode & 0o111).toBeTruthy()
  })

  it("a bare `gtd` on PATH inside the shim resolves and runs a real script", async () => {
    const shimDir = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return yield* createShim(fs, {
          exec: process.execPath,
          script: join(tmpDir, "fake-gtd.mjs"),
        })
      }).pipe(Effect.provide(NodeContext.layer)),
    )
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

    const { stdout } = await run("bash", ["-c", "gtd check qa 'a file.md'"], {
      env: { ...process.env, PATH: `${shimDir}:${process.env["PATH"] ?? ""}` },
    })
    expect(stdout.trim()).toBe("args:check,qa,a file.md")
  })

  it("two calls create two distinct directories, with no crosstalk", async () => {
    const [a, b] = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const first = yield* createShim(fs)
        const second = yield* createShim(fs)
        return [first, second] as const
      }).pipe(Effect.provide(NodeContext.layer)),
    )
    expect(a).not.toBe(b)
    expect(statSync(join(a, "gtd")).mode & 0o111).toBeTruthy()
    expect(statSync(join(b, "gtd")).mode & 0o111).toBeTruthy()
  })
})
