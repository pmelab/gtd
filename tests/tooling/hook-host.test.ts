import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import { HookHost, liveHookHost } from "../../src/hook/index.js"
import { inMemoryHookHost } from "../integration/support/hook-host.js"

// The hook host's file access, live and in memory, held to the same answers —
// what lets `gtd context-hook` scenarios run in-process.
interface Tier {
  readonly dir: string
  readonly write: (path: string, content: string) => void
  readonly content: (path: string) => string
  readonly host: Layer.Layer<HookHost>
  readonly dispose: () => void
}

const live = (): Tier => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-hook-host-"))
  return {
    dir,
    write: (path, content) => writeFileSync(path, content),
    content: (path) => readFileSync(path, "utf-8"),
    host: liveHookHost,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const inMemory = (): Tier => {
  const files = new Map<string, string>()
  return {
    dir: "/inmem-host",
    write: (path, content) => void files.set(path, content),
    content: (path) => files.get(path) ?? "",
    host: inMemoryHookHost(files),
    dispose: () => {},
  }
}

const use = <A>(tier: Tier, f: (host: HookHost["Type"]) => Effect.Effect<A, Error>): Promise<A> =>
  Effect.runPromise(Effect.flatMap(HookHost, f).pipe(Effect.provide(tier.host)))

describe.each([
  ["live", live],
  ["in memory", inMemory],
])("HookHost (%s)", (_, make) => {
  let tier: Tier
  afterEach(() => tier.dispose())

  it("reads a file outside the repository", async () => {
    tier = make()
    const path = join(tier.dir, "session.jsonl")
    tier.write(path, '{"type":"assistant"}\n')
    expect(await use(tier, (host) => host.readFile(path))).toBe('{"type":"assistant"}\n')
  })

  it("answers undefined for a missing file", async () => {
    tier = make()
    expect(await use(tier, (host) => host.readFile(join(tier.dir, "absent.jsonl")))).toBeUndefined()
  })

  it("appends to a file, creating it", async () => {
    tier = make()
    const path = join(tier.dir, "stop")
    await use(tier, (host) => host.appendFile(path, "one\n"))
    await use(tier, (host) => host.appendFile(path, "two\n"))
    expect(tier.content(path)).toBe("one\ntwo\n")
  })
})
