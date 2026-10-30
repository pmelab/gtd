import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute } from "node:path"
import { PassThrough } from "node:stream"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { Host, nodeStdio, type HostOps, type NodeProcess, type Stdio } from "../platform/index.js"
import { InMemRepo, inMemoryHost, makeCapturingCliIo } from "./index.js"

type Env = Readonly<Record<string, string | undefined>>

const root = realpathSync(process.cwd())

const fakeProcess = (stdin: string | Buffer[], argv = ["node"]) => {
  const input = new PassThrough()
  for (const chunk of typeof stdin === "string" ? [stdin] : stdin) input.write(chunk)
  input.end()
  const out = { stdout: "", stderr: "" }
  const sink = (name: keyof typeof out) => ({
    write: (chunk: string | Uint8Array, done?: () => void) => {
      out[name] += Buffer.from(chunk).toString("utf8")
      done?.()
      return true
    },
  })
  const proc = {
    argv,
    execPath: "/usr/bin/node",
    pid: 7,
    getuid: () => 501,
    stdin: input,
    stdout: sink("stdout"),
    stderr: sink("stderr"),
    exitCode: undefined,
  } as unknown as NodeProcess
  return { proc, out }
}

// The core reaches the machine through `Host`: Node's process live, nothing real in memory.
describe.each([
  [
    "live",
    (env: Env, stdin: string | Buffer[]) =>
      Host.layer({ root, home: root, env }, fakeProcess(stdin).proc),
  ],
  [
    "in memory",
    (env: Env, stdin: string | Buffer[]) =>
      Layer.succeed(
        Host,
        inMemoryHost(
          root,
          root,
          env,
          typeof stdin === "string" ? stdin : Buffer.concat(stdin).toString("utf8"),
        ),
      ),
  ],
])("Host (%s)", (_, layer) => {
  const run = <A>(
    f: (host: HostOps) => A | Effect.Effect<A, Error>,
    env: Env = {},
    stdin: string | Buffer[] = "",
  ): Promise<A> =>
    Effect.runPromise(
      Effect.flatMap(Host, (host) => {
        const result = f(host)
        return Effect.isEffect(result) ? result : Effect.succeed(result)
      }).pipe(Effect.provide(layer(env, stdin))),
    )

  it("puts scratch files under TMPDIR when it is set", async () => {
    expect(await run((host) => host.scratchDir, { TMPDIR: "/fixture-scratch" })).toBe(
      "/fixture-scratch",
    )
  })

  it("falls back to an absolute scratch dir when TMPDIR is unset or empty", async () => {
    expect(isAbsolute(await run((host) => host.scratchDir))).toBe(true)
    expect(await run((host) => host.scratchDir, { TMPDIR: "" })).toBe(
      await run((host) => host.scratchDir),
    )
  })

  it("reads stdin to its end as UTF-8, a character split across chunks included", async () => {
    const bytes = Buffer.from("verdict: ✓\n")
    const split = [bytes.subarray(0, 10), bytes.subarray(10)]
    expect(await run((host) => host.stdin, {}, split)).toBe("verdict: ✓\n")
    expect(await run((host) => host.stdin)).toBe("")
  })

  it("resolves the repository root to itself", async () => {
    expect(await run((host) => host.realPath(root))).toBe(root)
  })

  it("names gtd off PATH when no script runs it, and has a process id", async () => {
    const [self, pid] = await run((host) => [host.self, host.pid] as const)
    expect(self).toEqual(["gtd"])
    expect(Number.isInteger(pid)).toBe(true)
  })
})

describe("Host (live) alone", () => {
  const host = (proc: NodeProcess, env: Env = {}): Promise<HostOps> =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* Host
      }).pipe(Effect.provide(Host.layer({ root, home: root, env }, proc))),
    )

  it("falls back to node:os's tmpdir()", async () => {
    expect((await host(fakeProcess("").proc)).scratchDir).toBe(tmpdir())
  })

  it("runs itself again as its script under the running runtime", async () => {
    const { proc } = fakeProcess("", ["node", "/opt/gtd/gtd.js", "lsp"])
    const live = await host(proc)
    expect([live.self, live.pid, live.uid]).toEqual([["/usr/bin/node", "/opt/gtd/gtd.js"], 7, 501])
  })
})

// `runCli` writes through `Stdio` before any layer exists: Node's process live, a capture in memory.
describe.each([
  [
    "live",
    () => {
      const { proc, out } = fakeProcess("")
      return {
        stdio: nodeStdio(proc),
        seen: () => ({ ...out, exitCode: proc.exitCode }),
      }
    },
  ],
  [
    "in memory",
    () => {
      const { io, result } = makeCapturingCliIo(new InMemRepo())
      return { stdio: io as Stdio, seen: () => result() }
    },
  ],
])("Stdio (%s)", (_, make) => {
  it("writes stdout text and bytes, stderr, and exits with the code", () => {
    const { stdio, seen } = make()
    stdio.stdout("artifact")
    stdio.stdout(new TextEncoder().encode(" bytes ✓"))
    stdio.stderr("narration")
    stdio.exit(3)
    const { stdout, stderr, exitCode } = seen()
    expect([stdout, stderr, exitCode]).toEqual(["artifact bytes ✓", "narration", 3])
  })
})
