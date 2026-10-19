import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { LoopHost, liveLoopHost } from "../../src/loop/index.js"
import { inMemoryLoopHost } from "../integration/support/loop-host.js"

// The loop host's file reads, live and in memory, held to the same answers —
// what lets `gtd context-hook` scenarios read a transcript in-process.
interface Tier {
  readonly dir: string
  readonly write: (path: string, content: string) => void
  readonly host: () => Layer.Layer<LoopHost>
  readonly dispose: () => void
}

const live = (): Tier => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-loop-host-"))
  return {
    dir,
    write: (path, content) => writeFileSync(path, content),
    host: () => liveLoopHost,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const inMemory = (): Tier => {
  const files = new Map<string, string>()
  return {
    dir: "/inmem-host",
    write: (path, content) => void files.set(path, content),
    host: () =>
      inMemoryLoopHost(files, {}, (command, args) => {
        // The one script these cases run, answered as sh would print it.
        expect([command, ...args]).toEqual(["sh", "-c", SCRIPT])
        return { code: 0, stdout: "one\nstop\nafter\n", stderr: "" }
      }),
    dispose: () => {},
  }
}

const SCRIPT = "echo one; echo stop; sleep 5; echo after"

const spawn = (tier: Tier, stopAt: (line: string) => boolean) =>
  Effect.runPromise(
    Effect.flatMap(LoopHost, (host) =>
      host.spawn({ command: "sh", args: ["-c", SCRIPT], output: "capture", stopAt }),
    ).pipe(Effect.provide(tier.host())),
  )

const read = (tier: Tier, path: string): Promise<string | undefined> =>
  Effect.runPromise(
    Effect.flatMap(LoopHost, (host) => host.readFile(path)).pipe(Effect.provide(tier.host())),
  )

describe.each([
  ["live", live],
  ["in memory", inMemory],
])("LoopHost.readFile (%s)", (_, make) => {
  let tier: Tier
  afterEach(() => tier.dispose())

  it("reads a file outside the repository", async () => {
    tier = make()
    const path = join(tier.dir, "session.jsonl")
    tier.write(path, '{"type":"assistant"}\n')
    expect(await read(tier, path)).toBe('{"type":"assistant"}\n')
  })

  it("answers undefined for a missing file", async () => {
    tier = make()
    expect(await read(tier, join(tier.dir, "absent.jsonl"))).toBeUndefined()
  })
})

describe.each([
  ["live", live],
  ["in memory", inMemory],
])("LoopHost.spawn stopAt (%s)", (_, make) => {
  let tier: Tier
  afterEach(() => tier.dispose())

  it("stops the child at the first stdout line stopAt accepts", async () => {
    tier = make()
    const exit = await spawn(tier, (line) => line === "stop")
    expect(exit).toMatchObject({ code: 143, stopped: true })
    expect(exit.stdout).toBe("one\nstop\n")
  })

  it("runs to the end when no line is accepted", async () => {
    tier = make()
    const exit = await spawn(tier, (line) => line === "never")
    expect(exit.stopped).toBeUndefined()
    expect(exit.stdout).toBe("one\nstop\nafter\n")
  }, 10_000)
})
