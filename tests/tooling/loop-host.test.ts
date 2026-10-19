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
    host: () => inMemoryLoopHost(files),
    dispose: () => {},
  }
}

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
