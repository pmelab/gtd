import * as https from "node:https"
import * as http from "node:http"
import * as net from "node:net"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client"
import { Effect, Exit, Fiber, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { liveHeadSha } from "./Beat.js"
import type { AppRouter } from "./Router.js"
import { contentHashOf } from "./Write.js"

// `resolveBindHost`'s default `pickHost` reaches the real
// `os.networkInterfaces()` — mocked so the "calls through to the real system
// scan by default" test below is deterministic on any machine, tailnet or
// not, rather than depending on this runner having no Tailscale interface.
vi.mock("./BindSystem.js", () => ({ pickBindHostFromSystem: () => undefined }))

import { GtdError, GtdUsageError } from "../Commentary.js"
import { CommandRunner } from "../CommandRunner.js"
import { Cwd } from "../Cwd.js"
import type { UiConfig } from "../ConfigSchema.js"
import { renderQrCode } from "./Qr.js"
import { generateSelfSignedCert, type CertPair } from "./Tls.js"
import {
  HttpsServer,
  resolveBindHost,
  resolveCertPair,
  resolveClientHtml,
  runUiCommand,
} from "./Server.js"

let tmpDir: string
let gitDirs: string[]

beforeEach(() => {
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "gtd-ui-test-")))
  gitDirs = []
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  for (const dir of gitDirs) rmSync(dir, { recursive: true, force: true })
})

const noCommandRunner = CommandRunner.layer(() =>
  Effect.fail(new Error("CommandRunner unexpectedly invoked")),
)

/**
 * A real, minimal git repo at `dir` — every `runUiCommand` call reads the
 * served worktree's beat before doing anything else, so even a test that
 * doesn't care about the step's own content needs `dir` to be a readable git
 * worktree. `--separate-git-dir` (a linked-worktree-shaped `.git` FILE
 * carrying an ABSOLUTE `gitdir:` pointer, `WorktreeState.ts#worktreeGitDir`'s
 * own pointer branch) rather than a plain `.git` directory: the plain-repo
 * fallback there resolves relative to the CALLING PROCESS's own cwd (this
 * test file's), never `dir`, so `liveHeadSha` would silently read nothing
 * from `dir` at all — a real gitdir pointer sidesteps that entirely.
 */
const initGitRepo = (dir: string): void => {
  const gitDir = mkdtempSync(join(tmpdir(), "gtd-ui-test-gitdir-"))
  gitDirs.push(gitDir)
  execFileSync("git", ["init", "-q", `--separate-git-dir=${gitDir}`], { cwd: dir })
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir })
  writeFileSync(join(dir, "seed.txt"), "seed\n")
  execFileSync("git", ["add", "-A"], { cwd: dir })
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir })
}

/** Installs a fake `gtd` on `dir`'s own local `$PATH` (`Beat.ts#liveRunInWorktree` prepends `<cwd>/node_modules/.bin`) that answers every invocation with `beatJson` verbatim — the same seam `Beat.test.ts`/the pre-existing "live done/stop wiring" test used, just factored out since every `runUiCommand` test needs it now that the beat gates startup. */
const installFakeGtd = (dir: string, beatJson: string): void => {
  const bin = join(dir, "node_modules/.bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "gtd"), `#!/bin/sh\ncat <<'EOF'\n${beatJson}\nEOF\n`, { mode: 0o755 })
}

const renderablePromptJson = JSON.stringify({
  kind: "prompt",
  idle: false,
  actor: "human",
  label: "answer the questions",
  state: "build.review.await-review",
  file: "NOTES.md",
  mode: "qa",
})

describe("resolveBindHost", () => {
  it("prefers an explicit --host over everything else", async () => {
    const host = await Effect.runPromise(
      resolveBindHost("1.2.3.4", { host: "9.9.9.9" }, () => "100.90.1.2"),
    )
    expect(host).toBe("1.2.3.4")
  })

  it("falls back to a configured ui.host when --host is absent", async () => {
    const host = await Effect.runPromise(
      resolveBindHost(undefined, { host: "9.9.9.9" }, () => "100.90.1.2"),
    )
    expect(host).toBe("9.9.9.9")
  })

  it("falls back to a Tailscale scan when neither --host nor config.host is given", async () => {
    const host = await Effect.runPromise(resolveBindHost(undefined, undefined, () => "100.90.1.2"))
    expect(host).toBe("100.90.1.2")
  })

  it("calls through to pickBindHostFromSystem by default — the actual integration point, not a duplicate of Bind.test.ts's own unit tests", async () => {
    // No `pickHost` override: exercises the real default parameter
    // (`pickBindHostFromSystem`, mocked above to always return undefined so
    // this is deterministic regardless of the runner's actual network) —
    // proving Server.ts reached that seam rather than short-circuiting.
    const exit = await Effect.runPromiseExit(resolveBindHost(undefined, undefined))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("refuses with a GtdError naming both remedies when no host resolves at all", async () => {
    const thrown = await Effect.runPromise(
      resolveBindHost(undefined, undefined, () => undefined).pipe(Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message + thrown.detail.join("\n")).toContain("--host")
    expect(thrown.message + thrown.detail.join("\n")).toMatch(/tailnet|Tailscale/)
  })
})

describe("resolveCertPair", () => {
  it("--self-signed generates a certificate even when ui.cert/ui.key are configured — the explicit flag wins", async () => {
    const config: UiConfig = { cert: "/some/cert.pem", key: "/some/key.pem" }
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: true, dev: false }, config, "100.90.1.2").pipe(
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.flip,
      ),
    )
    // The fake CommandRunner fails every call — reaching its error proves
    // the self-signed path (not loadCertPair) was taken.
    expect(thrown.message).toContain("CommandRunner unexpectedly invoked")
  })

  it("with a hostname --host (not an IP literal), passes no IP: literal to openssl — only DNS", async () => {
    // openssl's `-addext subjectAltName=IP:...` rejects a non-literal value
    // outright; a hostname `--host` (e.g. "localhost") must not be handed
    // to Tls.ts's `ip` field, only to `host` (DNS).
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      return Effect.succeed({ status: 0, output: "" })
    })
    await Effect.runPromiseExit(
      resolveCertPair({ selfSigned: true, dev: false }, undefined, "localhost").pipe(
        Effect.provide(runner),
        Effect.provide(NodeContext.layer),
      ),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("DNS:localhost")
    expect(commands[0]).not.toContain("IP:localhost")
  })

  it("uses a configured ui.cert/ui.key pair as-is when --self-signed is absent", async () => {
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    const pair = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false, dev: false },
        { cert: certPath, key: keyPath },
        "100.90.1.2",
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer)),
    )
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
    expect(pair.key).toContain("BEGIN PRIVATE KEY")
  })

  it("refuses with a GtdError naming both remedies when neither --self-signed nor a configured pair is given", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: false, dev: false }, undefined, "100.90.1.2").pipe(
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.flip,
      ),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("--self-signed")
    expect(rendered).toMatch(/ui\.cert/)
  })

  it("names the missing half when only ui.cert is configured — not the generic 'no certificate is configured'", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false, dev: false },
        { cert: "/some/cert.pem" },
        "100.90.1.2",
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("ui.key")
    expect(rendered).not.toContain("no certificate is configured")
  })

  it("names the missing half when only ui.key is configured — not the generic 'no certificate is configured'", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false, dev: false },
        { key: "/some/key.pem" },
        "100.90.1.2",
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("ui.cert")
    expect(rendered).not.toContain("no certificate is configured")
  })
})

describe("HttpsServer.Live", () => {
  let cert: CertPair

  beforeEach(async () => {
    cert = await Effect.runPromise(
      generateSelfSignedCert({ host: "127.0.0.1", ip: "127.0.0.1" }).pipe(
        Effect.provide(CommandRunner.Live),
        Effect.provide(Cwd.layer(tmpDir)),
        Effect.provide(NodeContext.layer),
      ),
    )
  })

  it("binds unconditionally as HTTPS — a plain http request to the same port fails, a TLS request succeeds", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* HttpsServer
      }).pipe(Effect.provide(HttpsServer.Live)),
    )

    const bound = await Effect.runPromise(
      service.listen(cert, "127.0.0.1", 0, (_req, res) => {
        res.writeHead(200)
        res.end("ok")
      }),
    )

    try {
      const httpsResult = await new Promise<string>((resolve, reject) => {
        https
          .get({ host: "127.0.0.1", port: bound.port, rejectUnauthorized: false }, (res) => {
            let body = ""
            res.on("data", (chunk) => (body += chunk))
            res.on("end", () => resolve(body))
          })
          .on("error", reject)
      })
      expect(httpsResult).toBe("ok")

      const plainHttpFailed = await new Promise<boolean>((resolve) => {
        const req = http.get({ host: "127.0.0.1", port: bound.port }, () => {
          resolve(false)
        })
        req.on("error", () => resolve(true))
        req.setTimeout(2000, () => {
          req.destroy()
          resolve(true)
        })
      })
      expect(plainHttpFailed).toBe(true)
    } finally {
      bound.close()
    }
  })

  it("refuses with a GtdError naming EADDRINUSE when the port is already bound", async () => {
    const occupied = net.createServer()
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve))
    const address = occupied.address()
    const port = typeof address === "object" && address !== null ? address.port : 0

    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* HttpsServer
      }).pipe(Effect.provide(HttpsServer.Live)),
    )

    const thrown = await Effect.runPromise(
      service.listen(cert, "127.0.0.1", port, () => {}).pipe(Effect.flip),
    )
    occupied.close()

    expect(thrown).toBeInstanceOf(GtdError)
    expect(thrown.message).toContain("already in use")
  })
})

describe("resolveClientHtml", () => {
  it("in production, uses the build-time inlined constant and reads nothing off disk", async () => {
    const explodingFs = FileSystem.makeNoop({
      readFileString: () => Effect.die(new Error("unexpectedly read from disk in production")),
    })
    const runner = { bash: () => Effect.fail(new Error("unexpectedly shelled out in production")) }

    const html = await Effect.runPromise(
      resolveClientHtml(false, runner, explodingFs) as Effect.Effect<string, GtdError>,
    )
    expect(html).toContain("<!doctype html>")
  })

  it("in production, the inlined script has no bare (non-relative) import specifier — every dependency is actually bundled in", async () => {
    const explodingFs = FileSystem.makeNoop({
      readFileString: () => Effect.die(new Error("unexpectedly read from disk in production")),
    })
    const runner = { bash: () => Effect.fail(new Error("unexpectedly shelled out in production")) }

    const html = await Effect.runPromise(
      resolveClientHtml(false, runner, explodingFs) as Effect.Effect<string, GtdError>,
    )
    const bareImports = [...html.matchAll(/^\s*import[^;]*\sfrom\s+["']([^"']+)["']/gm)]
      .map((m) => m[1])
      .filter((specifier) => specifier !== undefined && !specifier.startsWith("."))
    expect(bareImports).toEqual([])
  })

  it("in production, the inlined script is exactly one <script> tag — a naive string .replace would expand a literal $& inside the bundle into a stray, script-terminating </script>", async () => {
    const explodingFs = FileSystem.makeNoop({
      readFileString: () => Effect.die(new Error("unexpectedly read from disk in production")),
    })
    const runner = { bash: () => Effect.fail(new Error("unexpectedly shelled out in production")) }

    const html = await Effect.runPromise(
      resolveClientHtml(false, runner, explodingFs) as Effect.Effect<string, GtdError>,
    )
    expect(html.match(/<\/script>/g)?.length).toBe(1)
  })

  it("under --dev, rebuilds the client via CommandRunner and reads both files fresh off disk", async () => {
    const readCalls: string[] = []
    const devFs = FileSystem.makeNoop({
      readFileString: (path: string) => {
        readCalls.push(path)
        return path.endsWith("index.html")
          ? Effect.succeed(
              '<!doctype html><body><script type="module" src="./main.js"></script></body>',
            )
          : Effect.succeed("console.log('dev build')")
      },
    })
    const bashCalls: string[] = []
    const runner = {
      bash: (command: string) => {
        bashCalls.push(command)
        return Effect.succeed({ status: 0, output: "" })
      },
    }

    const html = await Effect.runPromise(
      resolveClientHtml(true, runner, devFs) as Effect.Effect<string, GtdError>,
    )
    expect(bashCalls.some((c) => c.includes("tsdown"))).toBe(true)
    expect(readCalls.some((p) => p.endsWith("index.html"))).toBe(true)
    expect(readCalls.some((p) => p.endsWith("main.js"))).toBe(true)
    expect(html).toContain("console.log('dev build')")
    expect(html).not.toContain('src="./main.js"')
  })
})

describe("runUiCommand", () => {
  const fakeOut = () => {
    const written: string[] = []
    return { out: { write: (chunk: string) => written.push(chunk), flush: () => {} }, written }
  }

  /** Polls up to 1s for the forked fiber to run past the blocking wait and print its two lines — a single fixed `setTimeout` (the earlier shape here) is flaky under a loaded machine (e.g. the full `npm test` running build/lint/etc concurrently), where the fiber's own first tick can take longer than a bare 20ms. Mirrors `startScriptedServer`'s own poll below. */
  const waitForWrites = async (written: readonly string[], count: number): Promise<void> => {
    for (let i = 0; i < 50; i += 1) {
      if (written.length >= count) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`server never wrote ${count} lines (got ${written.length})`)
  }

  it("prints the https:// URL on its own line, then a QR code encoding that exact URL, before blocking", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    let closed = false
    const fakeHttpsServer = Layer.succeed(HttpsServer, {
      listen: () => Effect.succeed({ port: 4443, close: () => (closed = true) }),
    })

    const fiber = Effect.runFork(
      runUiCommand(
        { selfSigned: false, dev: false },
        { host: "100.90.1.2", cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeHttpsServer),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Cwd.layer(tmpDir)),
      ),
    )

    await waitForWrites(written, 2)

    expect(written[0]).toBe("https://100.90.1.2:4443/\n")
    // Pinned against the renderer's own output for the SAME URL just
    // printed above — deterministic, and it fails the moment the URL handed
    // to `renderQrCode` stops matching the one printed on the prior line.
    expect(written[1]).toBe(`${renderQrCode("https://100.90.1.2:4443/")}\n`)
    expect(written.length).toBe(2)

    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(closed).toBe(true)
  })

  it("T5: under --dev, rebuilds the client exactly once at startup — no HTTP request triggers a rebuild", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    const bashCalls: string[] = []
    const runner = CommandRunner.layer((command) => {
      bashCalls.push(command)
      return Effect.succeed({ status: 0, output: "" })
    })
    const devFs = FileSystem.makeNoop({
      readFileString: (path: string) =>
        Effect.succeed(
          path.endsWith("index.html")
            ? '<!doctype html><body><script type="module" src="./main.js"></script></body>'
            : "console.log('dev build')",
        ),
    })

    let handler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | undefined
    const fakeHttpsServer = Layer.succeed(HttpsServer, {
      listen: (_certPair, _host, _port, h) => {
        handler = h
        return Effect.succeed({ port: 4443, close: () => {} })
      },
    })

    const fiber = Effect.runFork(
      runUiCommand(
        { selfSigned: false, dev: true },
        { host: "100.90.1.2", cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeHttpsServer),
        Effect.provide(runner),
        Effect.provideService(FileSystem.FileSystem, devFs),
        Effect.provide(Cwd.layer(tmpDir)),
      ),
    )

    for (let i = 0; i < 50 && handler === undefined; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (handler === undefined) throw new Error("server never registered its request handler")
    const registeredHandler = handler

    const fakeReqRes = (): { body: string[] } => {
      const body: string[] = []
      const req = { url: "/", method: "GET" } as http.IncomingMessage
      const res = {
        writeHead: () => {},
        end: (chunk?: string) => {
          if (chunk !== undefined) body.push(chunk)
        },
      } as unknown as http.ServerResponse
      registeredHandler(req, res)
      return { body }
    }

    const first = fakeReqRes()
    const second = fakeReqRes()
    expect(first.body[0]).toContain("console.log('dev build')")
    expect(second.body[0]).toContain("console.log('dev build')")
    expect(bashCalls.filter((c) => c.includes("tsdown"))).toHaveLength(1)

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("refuses before ever reaching HttpsServer when no host resolves", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out } = fakeOut()
    let listenCalled = false
    const fakeHttpsServer = Layer.succeed(HttpsServer, {
      listen: () => {
        listenCalled = true
        return Effect.succeed({ port: 1, close: () => {} })
      },
    })

    const exit = await Effect.runPromiseExit(
      runUiCommand({ selfSigned: false, dev: false }, undefined, out).pipe(
        Effect.provide(fakeHttpsServer),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({} as never)),
        Effect.provide(Cwd.layer(tmpDir)),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(listenCalled).toBe(false)
  })

  describe("refusing to start on a step the UI cannot render", () => {
    /** Runs `runUiCommand` over `beatJson` and returns whether it ever reached `HttpsServer.listen` plus the thrown error, if any — every case here must refuse before binding, at exit-usage severity (`GtdUsageError`). Pre-written cert/key files (mirroring the URL-printing test above), so `noCommandRunner` (unreachable — `loadCertPair` only reads files) proves a refusal happens before certificate resolution could ever shell out. */
    const attemptStart = async (
      beatJson: string,
    ): Promise<{ readonly listenCalled: boolean; readonly error: unknown }> => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, beatJson)
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      const { out } = fakeOut()
      let listenCalled = false
      const fakeHttpsServer = Layer.succeed(HttpsServer, {
        listen: () => {
          listenCalled = true
          return Effect.succeed({ port: 1, close: () => {} })
        },
      })

      // Forked, not `runPromiseExit`, since a renderable step never resolves
      // on its own (it blocks on the handoff deferred, exactly like
      // production) — polls for either a refusal (the fiber completes by
      // itself) or a successful bind (`listenCalled` flips), then interrupts
      // either way. Interrupting an already-completed fiber just returns its
      // own settled `Exit`, so this same poll-then-interrupt shape covers
      // both outcomes without a second code path.
      const fiber = Effect.runFork(
        runUiCommand(
          { selfSigned: false, dev: false },
          { host: "100.90.1.2", cert: certPath, key: keyPath },
          out,
        ).pipe(
          Effect.provide(fakeHttpsServer),
          Effect.provide(noCommandRunner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Cwd.layer(tmpDir)),
        ),
      )
      for (let i = 0; i < 50; i += 1) {
        if (listenCalled) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const exit = await Effect.runPromise(Fiber.interrupt(fiber))

      const error = Exit.isFailure(exit)
        ? exit.cause._tag === "Fail"
          ? exit.cause.error
          : undefined
        : undefined
      return { listenCalled, error }
    }

    it("refuses a message step resting with a human but no steering file, naming the actor axis not the content kind", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({ kind: "message", idle: false, actor: "human", label: "just an fyi" }),
      )
      expect(listenCalled).toBe(false)
      expect(error).toBeInstanceOf(GtdUsageError)
      expect((error as GtdUsageError).message).toContain("just an fyi")
      expect((error as GtdUsageError).message).toContain("rests with you")
      expect((error as GtdUsageError).message).not.toContain("message")
    })

    it("refuses a script step resting with the agent, naming the actor not the content kind", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({ kind: "script", idle: false, actor: "agent", label: "run it" }),
      )
      expect(listenCalled).toBe(false)
      expect(error).toBeInstanceOf(GtdUsageError)
      expect((error as GtdUsageError).message).toContain("run it")
      expect((error as GtdUsageError).message).toContain("agent")
      expect((error as GtdUsageError).message).not.toContain("script")
    })

    it("refuses a capture step resting with a human but no steering file", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({ kind: "capture", idle: false, actor: "human", label: "capture it" }),
      )
      expect(listenCalled).toBe(false)
      expect(error).toBeInstanceOf(GtdUsageError)
      expect((error as GtdUsageError).message).toContain("rests with you")
    })

    it("refuses a stalled step resting with a human but no steering file", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({ kind: "stalled", idle: false, actor: "human", label: "stuck" }),
      )
      expect(listenCalled).toBe(false)
      expect(error).toBeInstanceOf(GtdUsageError)
      expect((error as GtdUsageError).message).not.toContain("stalled")
    })

    it("starts on a human, non-idle rest with file/mode even when the beat reports kind message — kind is never read", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({
          kind: "message",
          idle: false,
          actor: "human",
          label: "answer the questions",
          file: "NOTES.md",
          mode: "qa",
        }),
      )
      expect(listenCalled).toBe(true)
      expect(error).toBeUndefined()
    })

    it("refuses an idle worktree even if its kind is prompt", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({
          kind: "prompt",
          idle: true,
          actor: "human",
          label: "nothing pending",
          file: "NOTES.md",
          mode: "qa",
        }),
      )
      expect(listenCalled).toBe(false)
      expect(error).toBeInstanceOf(GtdUsageError)
      expect((error as GtdUsageError).message).toContain("idle")
    })

    it("refuses a prompt step whose mode resolves to no registered format", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({
          kind: "prompt",
          idle: false,
          actor: "human",
          label: "custom mode",
          file: "NOTES.md",
          mode: "not-a-real-mode",
        }),
      )
      expect(listenCalled).toBe(false)
      expect(error).toBeInstanceOf(GtdUsageError)
    })

    it("refuses a prompt step with no file at all", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({ kind: "prompt", idle: false, actor: "human", label: "no file" }),
      )
      expect(listenCalled).toBe(false)
      expect(error).toBeInstanceOf(GtdUsageError)
    })

    it("starts on a renderable prompt step — the positive control for every refusal above", async () => {
      const { listenCalled, error } = await attemptStart(renderablePromptJson)
      expect(listenCalled).toBe(true)
      expect(error).toBeUndefined()
    })
  })
})

/** Awaits `promise`, asserts it rejects with a real `TRPCClientError` (proof the request actually reached the real HTTP adapter and `errorFormatter`, unlike `createCaller` in unit tests elsewhere), and returns its `.data` — the one shape every `*Refusal` assertion below shares. */
const refusalDataFrom = async <T>(promise: Promise<unknown>): Promise<T | undefined> => {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(TRPCClientError)
  return (error as InstanceType<typeof TRPCClientError>).data as T | undefined
}

/**
 * Generates a self-signed cert into `dir`, installs a fake `gtd` reporting a
 * renderable prompt step (`renderablePromptJson`, actor "human" so the
 * write path never refuses `not-resting`), and starts a real `runUiCommand`
 * over `dir` as the served worktree — polling for the bound URL `out.write`
 * prints once `HttpsServer.Live` actually binds the ephemeral port.
 */
const startRealServer = async (
  dir: string,
): Promise<{ readonly boundUrl: string; readonly fiber: Fiber.RuntimeFiber<void, unknown> }> => {
  initGitRepo(dir)
  installFakeGtd(dir, renderablePromptJson)

  const certPath = join(dir, "cert.pem")
  const keyPath = join(dir, "key.pem")
  const cert = await Effect.runPromise(
    generateSelfSignedCert({ host: "127.0.0.1", ip: "127.0.0.1" }).pipe(
      Effect.provide(CommandRunner.Live),
      Effect.provide(Cwd.layer(dir)),
      Effect.provide(NodeContext.layer),
    ),
  )
  writeFileSync(certPath, cert.cert)
  writeFileSync(keyPath, cert.key)

  const written: string[] = []
  const out = { write: (chunk: string) => written.push(chunk), flush: () => {} }

  const fiber = Effect.runFork(
    runUiCommand(
      { selfSigned: false, dev: false, port: 0 },
      { host: "127.0.0.1", cert: certPath, key: keyPath, port: 0 },
      out,
    ).pipe(
      Effect.provide(HttpsServer.Live),
      Effect.provide(noCommandRunner),
      Effect.provide(NodeContext.layer),
      Effect.provide(Cwd.layer(dir)),
    ),
  )

  for (let i = 0; i < 50; i += 1) {
    if (written[0] !== undefined) return { boundUrl: written[0].trim(), fiber }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("server never printed its bound URL")
}

const withInsecureTls = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"]
    else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = previous
  }
}

describe("the tRPC API surface mounted under /trpc", () => {
  it("reaches Router.ts's view/readSteeringFile through the real HTTPS adapter end-to-end, with typed refusals separately readable", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir)

    // Real client dials a real self-signed HTTPS server — accepting that
    // untrusted cert is the only thing disabled here, matching what a phone
    // client does against `gtd ui --self-signed` today.
    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })

      // T2's "an unknown mode yields a typed refusal, not an empty screen":
      // `createCaller` (unit tests elsewhere) never runs `errorFormatter` at
      // all, so only a REAL client dialing a REAL server proves
      // `viewRefusal` actually reaches this far.
      const viewData = await refusalDataFrom<{ viewRefusal?: { reason: string } }>(
        client.view.query({ mode: "not-a-real-mode", content: "x" }),
      )
      expect(viewData?.viewRefusal?.reason).toBe("unsupported-mode")

      const readData = await refusalDataFrom<{ readRefusal?: { reason: string } }>(
        client.readSteeringFile.query({ filePath: "does-not-exist.md", mode: "qa" }),
      )
      expect(readData?.readRefusal?.reason).toBe("file-vanished")
    })

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("T4: readSteeringFile refuses a filePath other than the served step's own file — arbitrary reads inside the worktree are confined", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir)
    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      // renderablePromptJson names "NOTES.md" — a request for ANY other
      // path inside the worktree, including a real file like .git/config
      // (an actual git file initGitRepo creates, so this proves the refusal
      // is the confinement gate, not just resolveWithinRoot's "vanished"),
      // is refused identically.
      const readData = await refusalDataFrom<{ readRefusal?: { reason: string } }>(
        client.readSteeringFile.query({ filePath: ".git/config", mode: "qa" }),
      )
      expect(readData?.readRefusal?.reason).toBe("file-vanished")
    })
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("T4: writeNote/setValue refuse a filePath other than the served step's own file", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir)
    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const casFields = {
        filePath: "seed.txt",
        expectedHeadSha: "whatever",
        expectedContentHash: "whatever",
        mode: "qa",
        anchor: { kind: "paragraph" as const, line: 0 },
      }
      const writeData = await refusalDataFrom<{ writeRefusal?: { reason: string } }>(
        client.writeNote.mutate({ ...casFields, text: "hijacked" }),
      )
      expect(writeData?.writeRefusal?.reason).toBe("file-vanished")
      const setValueData = await refusalDataFrom<{ writeRefusal?: { reason: string } }>(
        client.setValue.mutate({ ...casFields, checked: true }),
      )
      expect(setValueData?.writeRefusal?.reason).toBe("file-vanished")
    })
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("step returns the served worktree's own beat, with no worktreePath input accepted", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir)
    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const step = await client.step.query()
      expect(step).toMatchObject({ status: "ok", kind: "prompt", file: "NOTES.md", mode: "qa" })
    })
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("step reports moved-on and ends the process once the outer loop advances the served rest's state", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir)
    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const first = await client.step.query()
      expect(first.status).toBe("ok")

      // The outer loop moved the worktree on to a different rest — same
      // shape, different `state` — while this server was still up.
      installFakeGtd(
        tmpDir,
        JSON.stringify({
          kind: "prompt",
          idle: false,
          actor: "human",
          label: "a different rest",
          state: "build.review.deciding",
          file: "NOTES.md",
          mode: "qa",
        }),
      )

      const second = await client.step.query()
      expect(second).toEqual({ status: "moved-on", label: "a different rest" })
    })

    // `Fiber.await`, not `Fiber.interrupt`: proves the main Effect completed
    // ON ITS OWN, driven by the same idempotent end-of-life resolve `handOff`
    // calls — no polling timer, this rides the `step` query the client
    // already issued above.
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(exit._tag).toBe("Success")
  })
})

describe("handoff exits the process", () => {
  it("done writes the note durably, then the main Effect completes once the response has flushed — no child process, no signal needed", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir)

    const filePath = "NOTES.md"
    const absPath = join(tmpDir, filePath)
    const content = "Paragraph zero here.\n\nParagraph two here.\n"
    writeFileSync(absPath, content)
    execFileSync("git", ["add", "-A"], { cwd: tmpDir })
    execFileSync("git", ["commit", "-q", "-m", "add notes"], { cwd: tmpDir })
    const headSha = await liveHeadSha(tmpDir)
    if (headSha === undefined) throw new Error("liveHeadSha resolved to undefined")

    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const result = await client.done.mutate({
        filePath,
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(content),
        mode: "qa",
        anchor: { kind: "paragraph", line: 0 },
        text: "handed back",
      })
      expect(result).toEqual({ ok: true })
    })

    // The write landed on disk before the process ever considers exiting —
    // a fresh `Fiber.await` (not `Fiber.interrupt`) proves the main Effect
    // completed ON ITS OWN, driven by `handOff`, never by an external signal.
    // Timed: the response's own `finish` event settles the handoff deferred
    // well under a second — an uncleared 2s fallback timer would keep the
    // event loop (and so this `Fiber.await`) alive for the timer's own full
    // duration regardless, since `settled` merely no-ops the callback rather
    // than removing the pending timer.
    const start = Date.now()
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(Date.now() - start).toBeLessThan(1_500)
    expect(exit._tag).toBe("Success")
    expect(readFileSync(absPath, "utf8")).toContain("handed back")
  })

  it("a refused write throws WriteNoteRefusal and never schedules a handoff — the server keeps running", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir)
    // NOTES.md must actually exist for this to reach the stale-token check
    // (not fail earlier as file-vanished) — its real token is deliberately
    // never used, so the compare-and-swap refuses.
    writeFileSync(join(tmpDir, "NOTES.md"), "Paragraph zero here.\n")
    execFileSync("git", ["add", "-A"], { cwd: tmpDir })
    execFileSync("git", ["commit", "-q", "-m", "add notes"], { cwd: tmpDir })

    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const error = await client.done
        .mutate({
          filePath: "NOTES.md",
          expectedHeadSha: "not-the-real-sha",
          expectedContentHash: "not-the-real-hash",
          mode: "qa",
          anchor: { kind: "paragraph", line: 0 },
          text: "should not land",
        })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(TRPCClientError)
      const data = (error as InstanceType<typeof TRPCClientError>).data as {
        writeRefusal?: { reason: string }
      }
      expect(data.writeRefusal?.reason).toBe("stale-token")

      // The server is still up: an ordinary query still answers.
      const step = await client.step.query()
      expect(step.status).toBe("ok")
    })

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("a 2s fallback timer hands off even when the client vanishes before the response flushes", async () => {
    // The fallback timer itself takes >=2s, so this needs headroom beyond
    // vitest's default 5s test timeout.
    const { boundUrl, fiber } = await startRealServer(tmpDir)

    const filePath = "NOTES.md"
    const content = "Paragraph zero here.\n"
    writeFileSync(join(tmpDir, filePath), content)
    execFileSync("git", ["add", "-A"], { cwd: tmpDir })
    execFileSync("git", ["commit", "-q", "-m", "add notes"], { cwd: tmpDir })
    const headSha = await liveHeadSha(tmpDir)
    if (headSha === undefined) throw new Error("liveHeadSha resolved to undefined")

    // A real `client.done.mutate` call, dialed through a custom `fetch` that
    // destroys its own socket the instant the request body is written —
    // before any response bytes can come back — so `res`'s own `finish`
    // event never fires for this call. `handOff`'s 2s fallback timer is the
    // only thing left that can ever resolve the deferred here. Routed
    // through the real client (not a hand-rolled body) so the request shape
    // — batching included — matches production exactly.
    const start = Date.now()
    const vanishingFetch = (
      input: string | URL,
      init?: { readonly method?: string; readonly headers?: unknown; readonly body?: unknown },
    ): Promise<Response> =>
      new Promise(() => {
        const target = new URL(input as string)
        const req = https.request(
          {
            host: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method: init?.method ?? "GET",
            rejectUnauthorized: false,
            headers: init?.headers as Record<string, string> | undefined,
          },
          () => {},
        )
        req.on("error", () => {})
        req.end(init?.body as string | undefined, () => req.destroy())
        // Never resolves — the caller below never awaits this fetch's own
        // client-side outcome, only whether the SERVER'S fiber completes.
      })
    const vanishingClient = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${boundUrl}trpc`, fetch: vanishingFetch })],
    })
    vanishingClient.done
      .mutate({
        filePath,
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(content),
        mode: "qa",
        anchor: { kind: "paragraph", line: 0 },
        text: "vanishing client",
      })
      .catch(() => {})

    // `Fiber.await`, not `Fiber.interrupt`: proves the main Effect completed
    // ON ITS OWN, driven by the fallback timer, not by an external signal.
    await Effect.runPromise(Fiber.await(fiber))
    const elapsedMs = Date.now() - start
    expect(elapsedMs).toBeGreaterThanOrEqual(1_900)
    expect(readFileSync(join(tmpDir, filePath), "utf8")).toContain("vanishing client")
  }, 10_000)
})
