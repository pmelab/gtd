import * as https from "node:https"
import * as http from "node:http"
import * as net from "node:net"
import { execFileSync, execSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  liveHeadSha,
  contentHashOf,
  pickBindHostFromSystem,
  deleteServeRecord,
  readServeRecord,
  writeServeRecord,
  parseTailscaleStatus,
  generateSelfSignedCert,
  type CertPair,
} from "./index.js"
import type { AppRouter } from "./Router.js"

// `resolveBindHost`'s default `pickHost` reaches the real
// `os.networkInterfaces()` — mocked so the "calls through to the real system
// scan by default" test below is deterministic on any machine, tailnet or
// not, rather than depending on this runner having no Tailscale interface.
vi.mock("./BindSystem.js", () => ({ pickBindHostFromSystem: vi.fn(() => undefined) }))

/**
 * `Serve.ts#serveDir`'s `base` parameter defaults to `homedir()` — a seam for
 * production, but `Server.ts`'s own `readServeRecord`/`writeServeRecord`/
 * `deleteServeRecord` calls never pass it, so they always resolve against the
 * REAL `~/.gtd/serve/` no matter what `Host.layer({ home: tmpDir })` a test
 * provides (that only sandboxes the served WORKTREE, never the OS home
 * directory `node:os#homedir` reads). The "Task 2 candidate walk" describe
 * block below drives the walk's own real candidate numbers (8443/10000/443)
 * end to end through `runUiCommand`, which would otherwise read/write/delete
 * a real `gtd ui`'s own ownership records at those exact paths. Mocking
 * `node:os` here — not just this test file's own `tmpdir` import above,
 * which stays passed through — intercepts `Serve.ts`'s `homedir()` call
 * transitively, so both the SUT and this file's own assertions agree on
 * whatever sandbox `homedirOverride.current` names. `current` stays
 * `undefined` (falls through to the real `homedir()`) for every OTHER test in
 * this file, which use dedicated non-standard ports precisely to make the
 * real home directory safe to touch.
 */
const homedirOverride = vi.hoisted(() => ({ current: undefined as string | undefined }))
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, homedir: () => homedirOverride.current ?? actual.homedir() }
})

import { GtdError, GtdUsageError } from "../Commentary.js"
import { CommandRunner } from "../CommandRunner.js"
import { Host } from "../platform/index.js"
import type { UiConfig } from "../ConfigSchema.js"
import type { RunInWorktree } from "./Beat.js"
import {
  buildFormatCommand,
  UiListener,
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

/**
 * Package 02's own idle rest: `idle: true`, no `mode` (free-form), and a
 * `state` that stays fixed across a `kind` flip — `readServedStep`'s own
 * moved-on gate reads `state`, never `kind`, so these two fixtures let a
 * test dirty the tree (flipping `message` → `capture`, the same flip a real
 * `gtd next --json` reports once `.gtd/TODO.md` has bytes) without changing
 * the one field that would end the server.
 */
const idleBeatJson = (kind: "message" | "capture"): string =>
  JSON.stringify({
    kind,
    idle: true,
    actor: "human",
    label: "Idle",
    state: "idle",
    file: ".gtd/TODO.md",
  })

describe("buildFormatCommand", () => {
  it("undefined ui.format yields no formatCommand at all — no command is ever spawned", () => {
    expect(buildFormatCommand(undefined, "/repo")).toBeUndefined()
  })

  it("renders it.file to the absolute path it's called with, and runs the rendered command in the worktree root", async () => {
    const calls: [string, string][] = []
    const run: RunInWorktree = async (cwd, command) => {
      calls.push([cwd, command])
      return { status: 0, stdout: "", stderr: "" }
    }
    const formatCommand = buildFormatCommand("npx oxfmt --write <%= it.file %>", "/repo", run)
    const outcome = await formatCommand!("/repo/.gtd/NOTES.md")
    expect(calls).toEqual([["/repo", "npx oxfmt --write /repo/.gtd/NOTES.md"]])
    expect(outcome).toEqual({
      ok: true,
      command: "npx oxfmt --write /repo/.gtd/NOTES.md",
      exitCode: 0,
    })
  })

  it("a non-zero exit reports ok: false with the exit code — never thrown", async () => {
    const run: RunInWorktree = async () => ({ status: 1, stdout: "", stderr: "bad" })
    const formatCommand = buildFormatCommand("false", "/repo", run)
    const outcome = await formatCommand!("/repo/x.md")
    expect(outcome).toEqual({ ok: false, command: "false", exitCode: 1 })
  })

  it("a missing binary (spawnError, no exit code) reports ok: false with a null exit code", async () => {
    const run: RunInWorktree = async () => ({
      status: null,
      stdout: "",
      stderr: "",
      spawnError: "ENOENT",
    })
    const formatCommand = buildFormatCommand("nonexistent-binary", "/repo", run)
    const outcome = await formatCommand!("/repo/x.md")
    expect(outcome).toEqual({ ok: false, command: "nonexistent-binary", exitCode: null })
  })

  it("a template that throws on render (a variable other than it.file) reports ok: false with a null exit code — never rejects", async () => {
    const run: RunInWorktree = async () => {
      throw new Error("must never spawn a command that never rendered")
    }
    const formatCommand = buildFormatCommand("npx run <%= it.vars.testCommand %>", "/repo", run)
    const outcome = await formatCommand!("/repo/x.md")
    expect(outcome).toEqual({
      ok: false,
      command: "npx run <%= it.vars.testCommand %>",
      exitCode: null,
    })
  })

  it("a malformed template (an unclosed Eta tag) reports ok: false with a null exit code — never rejects", async () => {
    const run: RunInWorktree = async () => ({ status: 0, stdout: "", stderr: "" })
    const formatCommand = buildFormatCommand("npx run <%= it.file", "/repo", run)
    const outcome = await formatCommand!("/repo/x.md")
    expect(outcome).toEqual({ ok: false, command: "npx run <%= it.file", exitCode: null })
  })
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
      resolveCertPair(
        { selfSigned: true, dev: false },
        config,
        "100.90.1.2",
        "100.90.1.2",
        undefined,
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer), Effect.flip),
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
      resolveCertPair(
        { selfSigned: true, dev: false },
        undefined,
        "localhost",
        "localhost",
        undefined,
      ).pipe(Effect.provide(runner), Effect.provide(NodeContext.layer)),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("DNS:localhost")
    expect(commands[0]).not.toContain("IP:localhost")
  })

  it("with the probe answering a tailnet hostname and no --host, the SAN carries the DISPLAY hostname as DNS: and the bind IP as IP: — never the bind IP as both", async () => {
    // Regression: --self-signed used to receive only bindHost, so a
    // probe-detected hostname URL over an IP bind got a SAN of
    // IP:<bind-ip>,DNS:<bind-ip> while the printed URL said
    // https://<tailnet-hostname>:.../ — a name mismatch on every load.
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      return Effect.succeed({ status: 0, output: "" })
    })
    await Effect.runPromiseExit(
      resolveCertPair(
        { selfSigned: true, dev: false },
        undefined,
        "100.90.1.2",
        "host.tailnet.ts.net",
        {
          hostname: "host.tailnet.ts.net",
          certDomains: [],
        },
      ).pipe(Effect.provide(runner), Effect.provide(NodeContext.layer)),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("DNS:host.tailnet.ts.net")
    expect(commands[0]).toContain("IP:100.90.1.2")
    expect(commands[0]).not.toContain("DNS:100.90.1.2")
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
        "100.90.1.2",
        undefined,
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer)),
    )
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
    expect(pair.key).toContain("BEGIN PRIVATE KEY")
  })

  it("refuses with a GtdError naming both remedies when neither --self-signed nor a configured pair is given", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false, dev: false },
        undefined,
        "100.90.1.2",
        "100.90.1.2",
        undefined,
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer), Effect.flip),
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
        "100.90.1.2",
        undefined,
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
        "100.90.1.2",
        undefined,
      ).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("ui.cert")
    expect(rendered).not.toContain("no certificate is configured")
  })

  it("obtains a real tailscale cert for the probed hostname when neither --self-signed nor a configured pair is given, and certDomains is non-empty", async () => {
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      const certMatch = command.match(/--cert-file '([^']+)'/)
      const keyMatch = command.match(/--key-file '([^']+)'/)
      if (certMatch?.[1]) {
        writeFileSync(
          certMatch[1],
          "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
        )
      }
      if (keyMatch?.[1]) {
        writeFileSync(keyMatch[1], "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      }
      return Effect.succeed({ status: 0, output: "" })
    })
    const pair = await Effect.runPromise(
      resolveCertPair({ selfSigned: false, dev: false }, undefined, "100.90.1.2", "100.90.1.2", {
        hostname: "host.tailnet.ts.net",
        certDomains: ["host.tailnet.ts.net"],
      }).pipe(Effect.provide(runner), Effect.provide(NodeContext.layer)),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("tailscale cert")
    expect(commands[0]).toContain("'host.tailnet.ts.net'")
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
  })

  it("drives the tailscale cert branch from a real `tailscale status --json` shape — proves the branch is reachable, not just the hand-built status object", async () => {
    // Regression for the top-level-vs-Self.CertDomains bug: this parses a
    // real-shaped status payload through parseTailscaleStatus (rather than
    // constructing a TailscaleStatus literal directly, as the other tests in
    // this describe block do) so the test fails against the pre-fix parser,
    // which always produced an empty certDomains and fell through to refusal.
    const realStatus = parseTailscaleStatus(
      JSON.stringify({
        BackendState: "Running",
        CertDomains: ["philipps-macbook-pro-m5.tailb2e719.ts.net"],
        Self: { DNSName: "philipps-macbook-pro-m5.tailb2e719.ts.net." },
      }),
    )
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      const certMatch = command.match(/--cert-file '([^']+)'/)
      const keyMatch = command.match(/--key-file '([^']+)'/)
      if (certMatch?.[1]) {
        writeFileSync(
          certMatch[1],
          "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
        )
      }
      if (keyMatch?.[1]) {
        writeFileSync(keyMatch[1], "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      }
      return Effect.succeed({ status: 0, output: "" })
    })
    const pair = await Effect.runPromise(
      resolveCertPair(
        { selfSigned: false, dev: false },
        undefined,
        "100.90.1.2",
        "100.90.1.2",
        realStatus,
      ).pipe(Effect.provide(runner), Effect.provide(NodeContext.layer)),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("tailscale cert")
    expect(commands[0]).toContain("'philipps-macbook-pro-m5.tailb2e719.ts.net'")
    expect(pair.cert).toContain("BEGIN CERTIFICATE")
  })

  it("falls through to the refusal, naming the Tailscale path, when the probe answered but certDomains is empty", async () => {
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: false, dev: false }, undefined, "100.90.1.2", "100.90.1.2", {
        hostname: "host.tailnet.ts.net",
        certDomains: [],
      }).pipe(Effect.provide(noCommandRunner), Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).toContain("--self-signed")
    expect(rendered).toMatch(/ui\.cert/)
    expect(rendered).toMatch(/tailnet|Tailscale/)
  })

  it("fails outright on a non-zero tailscale cert exit — no fallback to the refusal, no fallback to self-signed", async () => {
    const runner = CommandRunner.layer(() =>
      Effect.succeed({ status: 1, output: "tailscale cert: rate limited\n" }),
    )
    const thrown = await Effect.runPromise(
      resolveCertPair({ selfSigned: false, dev: false }, undefined, "100.90.1.2", "100.90.1.2", {
        hostname: "host.tailnet.ts.net",
        certDomains: ["host.tailnet.ts.net"],
      }).pipe(Effect.provide(runner), Effect.provide(NodeContext.layer), Effect.flip),
    )
    expect(thrown).toBeInstanceOf(GtdError)
    const rendered = thrown.message + thrown.detail.join("\n")
    expect(rendered).not.toContain("no certificate is configured")
    expect(rendered).toContain("rate limited")
  })
})

describe("UiListener.Live", () => {
  let cert: CertPair

  beforeEach(async () => {
    cert = await Effect.runPromise(
      generateSelfSignedCert({ host: "127.0.0.1", ip: "127.0.0.1" }).pipe(
        Effect.provide(CommandRunner.Live),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        Effect.provide(NodeContext.layer),
      ),
    )
  })

  it("with tls, behaves exactly as today — a plain http request to the same port fails, a TLS request succeeds", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* UiListener
      }).pipe(Effect.provide(UiListener.Live)),
    )

    const bound = await Effect.runPromise(
      service.listen({
        tls: cert,
        host: "127.0.0.1",
        port: 0,
        handler: (_req, res) => {
          res.writeHead(200)
          res.end("ok")
        },
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

  it("with no tls, binds a plain http:// listener that answers a real loopback request", async () => {
    const service = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* UiListener
      }).pipe(Effect.provide(UiListener.Live)),
    )

    const bound = await Effect.runPromise(
      service.listen({
        host: "127.0.0.1",
        port: 0,
        handler: (_req, res) => {
          res.writeHead(200)
          res.end("plain ok")
        },
      }),
    )

    try {
      const result = await new Promise<string>((resolve, reject) => {
        http
          .get({ host: "127.0.0.1", port: bound.port }, (res) => {
            let body = ""
            res.on("data", (chunk) => (body += chunk))
            res.on("end", () => resolve(body))
          })
          .on("error", reject)
      })
      expect(result).toBe("plain ok")
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
        return yield* UiListener
      }).pipe(Effect.provide(UiListener.Live)),
    )

    const thrown = await Effect.runPromise(
      service.listen({ tls: cert, host: "127.0.0.1", port, handler: () => {} }).pipe(Effect.flip),
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

  it("under --dev, also rebuilds the stylesheet via the Tailwind CLI and inlines it into a non-empty <style> block", async () => {
    const devFs = FileSystem.makeNoop({
      readFileString: (path: string) => {
        if (path.endsWith("index.html")) {
          return Effect.succeed(
            '<!doctype html><head><link rel="stylesheet" href="./main.css" /></head>' +
              '<body><script type="module" src="./main.js"></script></body>',
          )
        }
        if (path.endsWith("main.css")) return Effect.succeed("body{color:red}")
        return Effect.succeed("console.log('dev build')")
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
    expect(bashCalls.some((c) => c.includes("tailwindcss"))).toBe(true)
    expect(html).not.toContain('href="./main.css"')
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/)
    expect(styleMatch?.[1]?.trim()).toBe("body{color:red}")
  })
})

describe("the dark page shell", () => {
  // Package 01-dark-page-shell: components hardcode dark-surface colors and
  // expect a dark page under them — without a body background/text color the
  // page renders as broken paint (dark chips on white) rather than a theme.
  it("the production bundle's generated.html carries a body background and text color", async () => {
    const explodingFs = FileSystem.makeNoop({
      readFileString: () => Effect.die(new Error("unexpectedly read from disk in production")),
    })
    const runner = { bash: () => Effect.fail(new Error("unexpectedly shelled out in production")) }

    const html = await Effect.runPromise(
      resolveClientHtml(false, runner, explodingFs) as Effect.Effect<string, GtdError>,
    )
    expect(html).toMatch(/body\s*{[^}]*background/)
    expect(html).toMatch(/body\s*{[^}]*color(?!-scheme)/)
  })

  it("the --dev template read straight from src/web/index.html keeps color-scheme: dark, and styles.css (the source both prod and --dev compile through the same Tailwind CLI) carries the body background/text color", () => {
    const template = readFileSync(join(import.meta.dirname, "../web/index.html"), "utf8")
    expect(template).toContain("color-scheme: dark")
    expect(template).toMatch(/<link rel="stylesheet" href="\.\/main\.css" \/>/)

    const styles = readFileSync(join(import.meta.dirname, "../web/styles.css"), "utf8")
    expect(styles).toMatch(/body\s*{[^}]*background/)
    expect(styles).toMatch(/body\s*{[^}]*color(?!-scheme)/)
  })
})

describe("runUiCommand", () => {
  const fakeOut = () => {
    const written: string[] = []
    return { out: { write: (chunk: string) => written.push(chunk), flush: () => {} }, written }
  }

  /** Polls up to 3s for the forked fiber to run past the blocking wait and print its two lines — a single fixed `setTimeout` (the earlier shape here) is flaky under a loaded machine (e.g. the full `npm test` running build/lint/etc concurrently), where the fiber's own first tick can take longer than a bare 20ms. 1s (50 attempts) was itself measured flaky under the same concurrent-`npm test` CPU starvation `startRealServer`'s own 15s poll below documents — widened to match that budget's own reasoning, not just its symptom. Mirrors `startRealServer`'s own poll below. The final wait's own outcome is checked ONE more time before giving up — the loop's own condition only runs BEFORE each wait, so a write landing in exactly that last 20ms window was previously never observed at all, only visible after the fact in the thrown error's own "(got N)", which then read as already-satisfied — a round of review caught this exact confusing report. */
  const waitForWrites = async (written: readonly string[], count: number): Promise<void> => {
    for (let i = 0; i < 150; i += 1) {
      if (written.length >= count) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (written.length >= count) return
    throw new Error(`server never wrote ${count} lines (got ${written.length})`)
  }

  it("prints the https:// URL on its own line before blocking", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    let closed = false
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: () => Effect.succeed({ port: 4443, close: () => (closed = true) }),
    })

    const fiber = Effect.runFork(
      runUiCommand(
        { selfSigned: false, dev: false },
        { host: "100.90.1.2", cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 1)

    expect(written[0]).toBe("https://100.90.1.2:4443/\n")
    expect(written.length).toBe(1)

    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(closed).toBe(true)
  })

  it("--host given with no --port requests port 0 on the direct bind — the OS picks, and the printed URL reports what it picked", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    let requestedPort: number | undefined
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: ({ port }) => {
        requestedPort = port
        return Effect.succeed({ port: 55123, close: () => {} })
      },
    })

    const fiber = Effect.runFork(
      runUiCommand(
        { host: "100.64.0.1", selfSigned: false, dev: false },
        { cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 1)
    expect(requestedPort).toBe(0)
    expect(written[0]).toBe("https://100.64.0.1:55123/\n")

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("--port 0 on the direct bind path behaves exactly like no port given — requests 0, never a literal 0 in the URL", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    let requestedPort: number | undefined
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: ({ port }) => {
        requestedPort = port
        return Effect.succeed({ port: 55124, close: () => {} })
      },
    })

    const fiber = Effect.runFork(
      runUiCommand(
        { host: "100.64.0.1", port: 0, selfSigned: false, dev: false },
        { cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 1)
    expect(requestedPort).toBe(0)
    expect(written[0]).toBe("https://100.64.0.1:55124/\n")

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("ui.port: 0 in config behaves exactly like no port given on the direct bind path", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    let requestedPort: number | undefined
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: ({ port }) => {
        requestedPort = port
        return Effect.succeed({ port: 55125, close: () => {} })
      },
    })

    const fiber = Effect.runFork(
      runUiCommand(
        { host: "100.64.0.1", selfSigned: false, dev: false },
        { port: 0, cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 1)
    expect(requestedPort).toBe(0)
    expect(written[0]).toBe("https://100.64.0.1:55125/\n")

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  describe("no --host/ui.host given: attempts tailscale serve first", () => {
    // An explicit dedicated port, never the SERVE_PORT_CANDIDATES walk's own
    // 8443 first choice this test would otherwise resolve to when no `port`
    // option is given — Task 4's own ownership record lives at the REAL
    // `~/.gtd/serve/<port>.json` (`homedir()`, not a sandbox), so a real
    // `gtd ui` up on 8443 while this suite runs would make this test flaky
    // (a live foreign record) or, worse, have its teardown erase a real
    // orphaned mapping's only record (see `orphanPort` below and
    // `Serve.test.ts`'s own `testPort` for the same hazard/convention).
    const happyPathPort = 18442

    afterEach(() => {
      deleteServeRecord(happyPathPort)
    })

    it("binds an ephemeral loopback port and prints the probed tailnet hostname as the serve URL", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

      let boundHost: string | undefined
      let boundPort: number | undefined
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: ({ host, port }) => {
          boundHost = host
          boundPort = port
          return Effect.succeed({ port: 4443, close: () => {} })
        },
      })
      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        // "tailscale serve status --json" (the orphan check/live-mapping
        // probe, run twice — once before publishing, once at teardown) and
        // "tailscale serve --bg ..." (the publish itself) all succeed with
        // no prior mapping on this port.
        return Effect.succeed({ status: 0, output: "{}" })
      })

      const fiber = Effect.runFork(
        runUiCommand(
          { selfSigned: false, dev: false, port: happyPathPort },
          { cert: certPath, key: keyPath },
          out,
        ).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 1)

      expect(written[0]).toBe(`https://host.tailnet.ts.net:${happyPathPort}/\n`)
      // Never a 100.64.0.0/10 CGNAT address — the loopback listener binds
      // 127.0.0.1, letting `tailscaled` proxy in over the tailnet instead.
      expect(boundHost).toBe("127.0.0.1")
      // The loopback listener is asked for port 0 (OS-picked) — nothing
      // outside the machine dials it directly, so it must never be the
      // fixed serve port `tailscaled` itself terminates TLS on.
      expect(boundPort).toBe(0)
      expect(commands.some((c) => c.startsWith("tailscale serve --bg"))).toBe(true)
      // `attemptServe`'s own readback: the record it writes names the
      // ACTUAL port the (fake) listener bound (4443 here), not the `0` it
      // asked for.
      expect(readServeRecord(happyPathPort)?.targetPort).toBe(4443)

      await Effect.runPromise(Fiber.interrupt(fiber))
    })
  })

  describe("Task 2: the serve candidate walk (8443 → 10000 → 443) when no explicit --port is given", () => {
    // Drives the walk's own REAL candidate numbers (8443/10000/443) end to
    // end — never a dedicated 1844x port, the convention every other serve
    // test here uses — so `homedir()` itself is sandboxed for the duration
    // of this describe block (see the `vi.mock("node:os", ...)` above), not
    // just the served worktree. Without this, these tests would read/write/
    // delete a real `gtd ui`'s own `~/.gtd/serve/<port>.json` ownership
    // records on whatever machine runs them.
    let serveHome: string

    beforeEach(() => {
      serveHome = realpathSync(mkdtempSync(join(tmpdir(), "gtd-ui-test-serve-home-")))
      homedirOverride.current = serveHome
    })

    afterEach(() => {
      homedirOverride.current = undefined
      rmSync(serveHome, { recursive: true, force: true })
    })

    it("8443 carrying a foreign mapping, publish lands on 10000", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          // A foreign mapping exists on 8443 only — 10000/443 read as clear
          // off the very same JSON, since `parseServeStatus` filters by the
          // port suffix it's asked about.
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              Web: {
                "some-other-node.tailnet.ts.net:8443": {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } },
                },
              },
            }),
          })
        }
        return Effect.succeed({ status: 0, output: "{}" })
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false }, undefined, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 1)
      expect(written[0]).toBe("https://host.tailnet.ts.net:10000/\n")
      expect(written.length).toBe(1)
      expect(commands.some((c) => c.includes("--https=8443"))).toBe(false)
      expect(
        commands.some((c) => c.startsWith("tailscale serve --bg") && c.includes("--https=10000")),
      ).toBe(true)
      expect(readServeRecord(8443)).toBeUndefined()
      expect(readServeRecord(10000)).toBeDefined()

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("a non-zero publish exit on 8443 advances to 10000 rather than falling back", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          return Effect.succeed({ status: 0, output: "{}" })
        }
        if (command.startsWith("tailscale serve --bg")) {
          return command.includes("--https=8443")
            ? Effect.succeed({ status: 1, output: "", stderr: "simulated publish failure" })
            : Effect.succeed({ status: 0, output: "" })
        }
        return Effect.succeed({ status: 0, output: "{}" })
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false }, undefined, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 1)
      expect(written[0]).toBe("https://host.tailnet.ts.net:10000/\n")
      expect(written.length).toBe(1)
      expect(readServeRecord(10000)).toBeDefined()

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("a `tailscale serve status --json` probe that fails to run produces exactly ONE probe call, not three, and falls back", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")

      let serveStatusCalls = 0
      const runner = CommandRunner.layer((command) => {
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          serveStatusCalls += 1
          return Effect.succeed({ status: 1, output: "", stderr: "tailscaled not running" })
        }
        throw new Error(`unexpected command: ${command}`)
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false }, { cert: certPath, key: keyPath }, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 2)
      expect(written[0]).toContain("not using tailscale serve")
      // The fallback's own `resolveHostsAndCert` still probes Tailscale
      // status for a display hostname (unrelated to the serve attempt) — it
      // binds the CGNAT IP but displays the probed tailnet hostname.
      expect(written[1]).toBe("https://host.tailnet.ts.net:4443/\n")
      expect(serveStatusCalls).toBe(1)

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("no Tailscale backend detected falls back without probing any candidate", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")

      let statusCalls = 0
      const runner = CommandRunner.layer((command) => {
        if (command === "tailscale status --json") {
          statusCalls += 1
          return Effect.succeed({ status: 0, output: JSON.stringify({ BackendState: "Stopped" }) })
        }
        throw new Error(`unexpected command: ${command}`)
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false }, { cert: certPath, key: keyPath }, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 2)
      expect(written[0]).toContain("not using tailscale serve")
      expect(written[1]).toBe("https://100.90.1.2:4443/\n")
      // 2, not 3+: one from `attemptServe`'s own bail on the first (and
      // only) candidate attempted, one from the fallback's own unrelated
      // `resolveHostsAndCert` display-hostname probe — never a second
      // candidate's worth of probing.
      expect(statusCalls).toBe(2)

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("all three candidates occupied prints exactly one fallback line naming all three ports, then binds directly — never a refusal", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              Web: {
                "foreign.tailnet.ts.net:8443": {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:9991" } },
                },
                "foreign.tailnet.ts.net:10000": {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:9992" } },
                },
                "foreign.tailnet.ts.net:443": {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:9993" } },
                },
              },
            }),
          })
        }
        throw new Error(`unexpected command: ${command}`)
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false }, { cert: certPath, key: keyPath }, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 2)
      expect(written[0]).toContain("not using tailscale serve")
      expect(written[0]).toContain("8443")
      expect(written[0]).toContain("10000")
      expect(written[0]).toContain("443")
      expect(written.length).toBe(2)
      expect(written[1]).toBe("https://host.tailnet.ts.net:4443/\n")
      expect(commands.some((c) => c.startsWith("tailscale serve --bg"))).toBe(false)

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("an occupied explicit --port falls back rather than trying 10000", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")

      const explicitPort = 19555
      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              Web: {
                [`foreign.tailnet.ts.net:${explicitPort}`]: {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:9991" } },
                },
              },
            }),
          })
        }
        throw new Error(`unexpected command: ${command}`)
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand(
          { selfSigned: false, dev: false, port: explicitPort },
          { cert: certPath, key: keyPath },
          out,
        ).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 2)
      expect(written[0]).toContain("not using tailscale serve")
      expect(written[0]).not.toContain("10000")
      expect(written[1]).toBe("https://host.tailnet.ts.net:4443/\n")
      expect(commands.some((c) => c.startsWith("tailscale serve --bg"))).toBe(false)

      await Effect.runPromise(Fiber.interrupt(fiber))
      deleteServeRecord(explicitPort)
    })

    it("--port 0 on the serve path behaves exactly like no port given — walks past a foreign 8443 onto 10000, never a one-element [0] list", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          // A foreign mapping on 8443 only — a one-element `[0]` candidate
          // list (the bug `normalizePort` exists to prevent) would either
          // reach `publishServe --https=0` directly or bail here with no
          // second candidate to fall through to; the walk instead must skip
          // past it onto 10000, identical to the no-port-given case.
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              Web: {
                "some-other-node.tailnet.ts.net:8443": {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } },
                },
              },
            }),
          })
        }
        return Effect.succeed({ status: 0, output: "{}" })
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ port: 0, selfSigned: false, dev: false }, undefined, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 1)
      expect(written[0]).toBe("https://host.tailnet.ts.net:10000/\n")
      expect(written.length).toBe(1)
      expect(commands.some((c) => c.includes("--https=0"))).toBe(false)
      expect(readServeRecord(10000)).toBeDefined()

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("ui.port: 0 in config behaves exactly like no port given on the serve path — walks past a foreign 8443 onto 10000", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              Web: {
                "some-other-node.tailnet.ts.net:8443": {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } },
                },
              },
            }),
          })
        }
        return Effect.succeed({ status: 0, output: "{}" })
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false }, { port: 0 }, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 1)
      expect(written[0]).toBe("https://host.tailnet.ts.net:10000/\n")
      expect(written.length).toBe(1)
      expect(commands.some((c) => c.includes("--https=0"))).toBe(false)
      expect(readServeRecord(10000)).toBeDefined()

      await Effect.runPromise(Fiber.interrupt(fiber))
    })
  })

  it("no --host/ui.host given, no Tailscale backend detected: falls back to the direct CGNAT bind, printing the fallback reason above the URL", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")
    let boundHost: string | undefined
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: ({ host }) => {
        boundHost = host
        return Effect.succeed({ port: 4443, close: () => {} })
      },
    })
    // The empty-probe case: BackendState isn't "Running", one of the three
    // ways `Tailscale.ts#parseTailscaleStatus` falls back to `undefined` —
    // `attemptServe` bails before ever touching a socket or a record file.
    const runner = CommandRunner.layer(() =>
      Effect.succeed({ status: 0, output: JSON.stringify({ BackendState: "Stopped" }) }),
    )

    const fiber = Effect.runFork(
      runUiCommand({ selfSigned: false, dev: false }, { cert: certPath, key: keyPath }, out).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(runner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 2)

    expect(written[0]).toContain("not using tailscale serve")
    expect(written[1]).toBe("https://100.90.1.2:4443/\n")
    expect(boundHost).toBe("100.90.1.2")

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("skips the Tailscale probe entirely when --host is given explicitly — CommandRunner is never invoked", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    const fakeUiListener = Layer.succeed(UiListener, {
      listen: () => Effect.succeed({ port: 4443, close: () => {} }),
    })

    const fiber = Effect.runFork(
      runUiCommand(
        { selfSigned: false, dev: false, host: "1.2.3.4" },
        { cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 1)
    expect(written[0]).toBe("https://1.2.3.4:4443/\n")

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("--self-signed skips the serve attempt entirely, even with no --host given — no `tailscale serve` invocation at all", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()

    vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: () => Effect.succeed({ port: 4443, close: () => {} }),
    })
    // `resolveHostsAndCert`'s own pre-existing Tailscale STATUS probe (for a
    // display hostname in the self-signed cert's SAN) still runs, and
    // `--self-signed` itself shells out to real `openssl` — only the serve
    // ATTEMPT (`tailscale serve status`/`tailscale serve --bg`) is what
    // --self-signed skips, so `openssl` commands are run for real here
    // (mirroring `CommandRunner.Live`) rather than faked, letting
    // `generateSelfSignedCert` read back real PEM files afterward.
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      if (command.startsWith("openssl")) {
        try {
          const output = execSync(command, { shell: "/bin/bash" }).toString()
          return Effect.succeed({ status: 0, output })
        } catch (e) {
          return Effect.succeed({ status: 1, output: e instanceof Error ? e.message : String(e) })
        }
      }
      return Effect.succeed({ status: 0, output: JSON.stringify({ BackendState: "Stopped" }) })
    })

    const fiber = Effect.runFork(
      runUiCommand({ selfSigned: true, dev: false }, undefined, out).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(runner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 1)
    expect(written[0]).toBe("https://100.90.1.2:4443/\n")
    expect(commands.some((c) => c.includes("tailscale serve"))).toBe(false)

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("no --host given, tailscale serve itself fails to publish: falls back to the direct CGNAT bind — never a refusal", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: () => Effect.succeed({ port: 4443, close: () => {} }),
    })
    // A configured ui.cert/ui.key so the FALLBACK's own certificate
    // resolution needs no further CommandRunner call of its own — isolating
    // this test to the one thing under test, the publish failure itself.
    const runner = CommandRunner.layer((command) => {
      if (command === "tailscale status --json") {
        return Effect.succeed({
          status: 0,
          output: JSON.stringify({
            BackendState: "Running",
            CertDomains: ["host.tailnet.ts.net"],
            Self: { DNSName: "host.tailnet.ts.net." },
          }),
        })
      }
      if (command === "tailscale serve status --json") {
        return Effect.succeed({ status: 0, output: "{}" })
      }
      // The publish call itself: a non-zero exit, never a failed Effect.
      return Effect.succeed({ status: 1, output: "", stderr: "tailscale: needs operator access" })
    })

    const fiber = Effect.runFork(
      runUiCommand({ selfSigned: false, dev: false }, { cert: certPath, key: keyPath }, out).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(runner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 2)
    expect(written[0]).toContain("not using tailscale serve")
    // The fallback's own `resolveHostsAndCert` still probes Tailscale status
    // for a DISPLAY hostname (pre-existing behavior, unrelated to serve) —
    // it binds the CGNAT IP but displays the probed tailnet hostname, same
    // as the "probed Tailscale hostname" scenario above.
    expect(written[1]).toBe("https://host.tailnet.ts.net:4443/\n")

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("no --host given, the loopback listener itself refuses (EADDRINUSE et al): falls back to the direct CGNAT bind — never a refusal", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out, written } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")
    // The serve attempt's own loopback bind (no `tls`) fails outright; the
    // fallback's direct TLS bind (`tls` present) still succeeds — proving
    // `attemptServe` catches the listen failure into `ok: false` rather than
    // letting it propagate out of the Effect.
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: ({ tls }) =>
        tls === undefined
          ? Effect.fail(new GtdError("gtd ui: port 0 is already in use"))
          : Effect.succeed({ port: 4443, close: () => {} }),
    })
    const runner = CommandRunner.layer((command) => {
      if (command === "tailscale status --json") {
        return Effect.succeed({
          status: 0,
          output: JSON.stringify({
            BackendState: "Running",
            CertDomains: ["host.tailnet.ts.net"],
            Self: { DNSName: "host.tailnet.ts.net." },
          }),
        })
      }
      if (command === "tailscale serve status --json") {
        return Effect.succeed({ status: 0, output: "{}" })
      }
      throw new Error(`unexpected command: ${command}`)
    })

    const fiber = Effect.runFork(
      runUiCommand({ selfSigned: false, dev: false }, { cert: certPath, key: keyPath }, out).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(runner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    await waitForWrites(written, 2)
    expect(written[0]).toContain("not using tailscale serve")
    expect(written[0]).toContain("could not bind the loopback listener")
    expect(written[1]).toBe("https://host.tailnet.ts.net:4443/\n")

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  describe("Task 4's ownership guarantees, exercised through the real ~/.gtd/serve/<port>.json record", () => {
    // A port dedicated to these three tests — distinct from the "no --host"
    // happy-path test above (its own explicit port) and from
    // `ui-lifecycle.feature`'s own real-tailscale-shim `@live` scenario
    // (18443) — so a concurrently-running project never races the same
    // real record file.
    const orphanPort = 18444

    afterEach(() => {
      deleteServeRecord(orphanPort)
    })

    it("a foreign live mapping with no record of ours is left untouched — falls back to the direct bind, never publishes", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              Web: {
                [`some-other-node.tailnet.ts.net:${orphanPort}`]: {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } },
                },
              },
            }),
          })
        }
        throw new Error(`unexpected command: ${command}`)
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand(
          { selfSigned: false, dev: false, port: orphanPort },
          { cert: certPath, key: keyPath },
          out,
        ).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 2)
      expect(written[0]).toContain("not using tailscale serve")
      expect(written[1]).toBe("https://host.tailnet.ts.net:4443/\n")
      expect(commands.some((c) => c.startsWith("tailscale serve --bg"))).toBe(false)
      expect(readServeRecord(orphanPort)).toBeUndefined()

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("a stderr warning merged into an exit-0 probe's output does not mask a foreign live mapping — reads stdout alone, never publishes over it", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          // A real `tailscale` prints a client/daemon version-mismatch
          // warning to stderr even on a successful exit-0 run —
          // `CommandRunner.Live`'s `output` MERGES stdout+stderr, so the
          // warning text lands right after the JSON and breaks the parse
          // unless the probe reads `stdout` alone.
          const stdout = JSON.stringify({
            Web: {
              [`some-other-node.tailnet.ts.net:${orphanPort}`]: {
                Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } },
              },
            },
          })
          const stderr = "Warning: client version 1.99.0 != tailscaled server version 1.98.0\n"
          return Effect.succeed({ status: 0, output: stdout + stderr, stdout, stderr })
        }
        throw new Error(`unexpected command: ${command}`)
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand(
          { selfSigned: false, dev: false, port: orphanPort },
          { cert: certPath, key: keyPath },
          out,
        ).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 2)
      expect(written[0]).toContain("not using tailscale serve")
      expect(written[1]).toBe("https://host.tailnet.ts.net:4443/\n")
      expect(commands.some((c) => c.startsWith("tailscale serve --bg"))).toBe(false)
      expect(readServeRecord(orphanPort)).toBeUndefined()

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("a `tailscale serve status` probe that fails to run can't prove the port is free — falls back, never publishes over an unseen mapping", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()
      const certPath = join(tmpDir, "cert.pem")
      const keyPath = join(tmpDir, "key.pem")
      writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
      writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")
      vi.mocked(pickBindHostFromSystem).mockReturnValueOnce("100.90.1.2")

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          // A non-zero exit — an operator-permission error, a tailscaled
          // restart mid-probe — never JSON to parse at all. Distinct from
          // an empty `{}`: unreadable status proves nothing about whether
          // the port is free.
          return Effect.succeed({ status: 1, output: "", stderr: "tailscaled not running" })
        }
        throw new Error(`unexpected command: ${command}`)
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand(
          { selfSigned: false, dev: false, port: orphanPort },
          { cert: certPath, key: keyPath },
          out,
        ).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 2)
      expect(written[0]).toContain("not using tailscale serve")
      expect(written[1]).toBe("https://host.tailnet.ts.net:4443/\n")
      expect(commands.some((c) => c.startsWith("tailscale serve --bg"))).toBe(false)
      expect(readServeRecord(orphanPort)).toBeUndefined()

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("a record naming a dead pid is cleared before publishing — unpublished, deleted, then a fresh mapping published", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()

      writeServeRecord(orphanPort, {
        pid: 999_999_999, // never a real pid on any machine running this test
        servePort: orphanPort,
        targetPort: 1,
        target: "http://127.0.0.1:1",
        worktree: "/repo/stale-worktree",
      })

      const commands: string[] = []
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        // Both the orphan-check's own status probe and the publish/unpublish
        // calls succeed unconditionally — this test is only about ORDER
        // (unpublish-then-publish) and the record's own final state.
        return Effect.succeed({ status: 0, output: "{}" })
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false, port: orphanPort }, undefined, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 1)
      expect(written[0]).toBe(`https://host.tailnet.ts.net:${orphanPort}/\n`)

      const offIndex = commands.findIndex((c) => c.includes(`--https=${orphanPort} off`))
      const publishIndex = commands.findIndex((c) => c.startsWith("tailscale serve --bg"))
      expect(offIndex).toBeGreaterThanOrEqual(0)
      expect(publishIndex).toBeGreaterThan(offIndex)

      const freshRecord = readServeRecord(orphanPort)
      expect(freshRecord?.pid).toBe(process.pid)
      expect(freshRecord?.targetPort).toBe(4443)

      await Effect.runPromise(Fiber.interrupt(fiber))
    })

    it("teardown: a record whose target no longer matches the live mapping is deleted WITHOUT unpublishing it", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()

      const commands: string[] = []
      // The FIRST "tailscale serve status --json" is the orphan check ahead
      // of publishing — empty, so this run's own publish proceeds normally.
      // Every call AFTER that is teardown's own re-read: the live mapping
      // now points somewhere else, as if another process took the port over
      // while this one was up.
      let serveStatusCalls = 0
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          serveStatusCalls += 1
          if (serveStatusCalls === 1) return Effect.succeed({ status: 0, output: "{}" })
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              Web: {
                [`someone-else.tailnet.ts.net:${orphanPort}`]: {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:55555" } },
                },
              },
            }),
          })
        }
        return Effect.succeed({ status: 0, output: "{}" })
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false, port: orphanPort }, undefined, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 1)
      // A record now exists (this run's own publish, since no record existed
      // beforehand and no foreign mapping was reported — the scripted
      // "tailscale serve status --json" above is only consulted for the
      // orphan check BEFORE the record below is written by this same run).
      expect(readServeRecord(orphanPort)).toBeDefined()

      await Effect.runPromise(Fiber.interrupt(fiber))

      expect(readServeRecord(orphanPort)).toBeUndefined()
      expect(commands.some((c) => c.includes(`--https=${orphanPort} off`))).toBe(false)
    })

    it("teardown: a `tailscale serve status` probe that fails to run leaves the record in place — never deletes evidence it can't confirm is stale", async () => {
      initGitRepo(tmpDir)
      installFakeGtd(tmpDir, renderablePromptJson)
      const { out, written } = fakeOut()

      const commands: string[] = []
      // The FIRST "tailscale serve status --json" is the orphan check ahead
      // of publishing — empty, so this run's own publish proceeds normally.
      // The SECOND is teardown's own re-read: a non-zero exit, as if
      // tailscaled was mid-restart or the operator permission had lapsed —
      // proves nothing about whether the mapping is still ours, so teardown
      // must not delete the record on the strength of it.
      let serveStatusCalls = 0
      const runner = CommandRunner.layer((command) => {
        commands.push(command)
        if (command === "tailscale status --json") {
          return Effect.succeed({
            status: 0,
            output: JSON.stringify({
              BackendState: "Running",
              CertDomains: ["host.tailnet.ts.net"],
              Self: { DNSName: "host.tailnet.ts.net." },
            }),
          })
        }
        if (command === "tailscale serve status --json") {
          serveStatusCalls += 1
          if (serveStatusCalls === 1) return Effect.succeed({ status: 0, output: "{}" })
          return Effect.succeed({ status: 1, output: "", stderr: "tailscaled not running" })
        }
        return Effect.succeed({ status: 0, output: "{}" })
      })
      const fakeUiListener = Layer.succeed(UiListener, {
        listen: () => Effect.succeed({ port: 4443, close: () => {} }),
      })

      const fiber = Effect.runFork(
        runUiCommand({ selfSigned: false, dev: false, port: orphanPort }, undefined, out).pipe(
          Effect.provide(fakeUiListener),
          Effect.provide(runner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
        ),
      )

      await waitForWrites(written, 1)
      const publishedRecord = readServeRecord(orphanPort)
      expect(publishedRecord).toBeDefined()

      await Effect.runPromise(Fiber.interrupt(fiber))

      // Left exactly as published — neither deleted nor unpublished. The
      // describe block's own `afterEach` cleans it up.
      expect(readServeRecord(orphanPort)).toEqual(publishedRecord)
      expect(commands.some((c) => c.includes(`--https=${orphanPort} off`))).toBe(false)
    })
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
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: ({ handler: h }) => {
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
        Effect.provide(fakeUiListener),
        Effect.provide(runner),
        Effect.provideService(FileSystem.FileSystem, devFs),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
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

  it("refuses before ever reaching UiListener when no host resolves", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out } = fakeOut()
    let listenCalled = false
    const fakeUiListener = Layer.succeed(UiListener, {
      listen: () => {
        listenCalled = true
        return Effect.succeed({ port: 1, close: () => {} })
      },
    })

    const exit = await Effect.runPromiseExit(
      runUiCommand({ selfSigned: false, dev: false }, undefined, out).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({} as never)),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(listenCalled).toBe(false)
  })

  it("Task 5: an explicit --port held by another process refuses naming the REQUESTED port, not the 0 a default bind would ask for", async () => {
    initGitRepo(tmpDir)
    installFakeGtd(tmpDir, renderablePromptJson)
    const { out } = fakeOut()
    const certPath = join(tmpDir, "cert.pem")
    const keyPath = join(tmpDir, "key.pem")
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n")

    const fakeUiListener = Layer.succeed(UiListener, {
      listen: ({ port }) => Effect.fail(new GtdError(`gtd ui: port ${port} is already in use`)),
    })

    const exit = await Effect.runPromiseExit(
      runUiCommand(
        { host: "100.64.0.1", port: 4443, selfSigned: false, dev: false },
        { cert: certPath, key: keyPath },
        out,
      ).pipe(
        Effect.provide(fakeUiListener),
        Effect.provide(noCommandRunner),
        Effect.provide(NodeContext.layer),
        Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause)
      expect(failure._tag).toBe("Some")
      if (failure._tag === "Some") {
        expect(failure.value.message).toBe("gtd ui: port 4443 is already in use")
      }
    }
  })

  describe("refusing to start on a step the UI cannot render", () => {
    /** Runs `runUiCommand` over `beatJson` and returns whether it ever reached `UiListener.listen` plus the thrown error, if any — every case here must refuse before binding, at exit-usage severity (`GtdUsageError`). Pre-written cert/key files (mirroring the URL-printing test above), so `noCommandRunner` (unreachable — `loadCertPair` only reads files) proves a refusal happens before certificate resolution could ever shell out. */
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
      const fakeUiListener = Layer.succeed(UiListener, {
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
          Effect.provide(fakeUiListener),
          Effect.provide(noCommandRunner),
          Effect.provide(NodeContext.layer),
          Effect.provide(Host.layer({ root: tmpDir, home: tmpDir, env: process.env })),
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

    it("an idle rest carrying a file binds and serves it — idle is no longer a startup refusal", async () => {
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
      expect(listenCalled).toBe(true)
      expect(error).toBeUndefined()
    })

    it("starts on a prompt step whose mode resolves to no registered format — falls back to free-form", async () => {
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
      expect(listenCalled).toBe(true)
      expect(error).toBeUndefined()
    })

    it("starts on a prompt step with no mode at all — falls back to free-form", async () => {
      const { listenCalled, error } = await attemptStart(
        JSON.stringify({
          kind: "prompt",
          idle: false,
          actor: "human",
          label: "no mode",
          file: "NOTES.md",
        }),
      )
      expect(listenCalled).toBe(true)
      expect(error).toBeUndefined()
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
 * prints once `UiListener.Live` actually binds the ephemeral port.
 */
const startRealServer = async (
  dir: string,
  /** `ui.format`'s own value for this server, `undefined` (the default) meaning no formatter configured — the same config field a real `.gtdrc` would carry. */
  format?: string,
  /** The fake `gtd`'s own beat JSON — `renderablePromptJson` (the default) unless a test needs a different rest (an idle one, for package 02). */
  beatJson: string = renderablePromptJson,
): Promise<{ readonly boundUrl: string; readonly fiber: Fiber.RuntimeFiber<void, unknown> }> => {
  initGitRepo(dir)
  installFakeGtd(dir, beatJson)

  const certPath = join(dir, "cert.pem")
  const keyPath = join(dir, "key.pem")
  const cert = await Effect.runPromise(
    generateSelfSignedCert({ host: "127.0.0.1", ip: "127.0.0.1" }).pipe(
      Effect.provide(CommandRunner.Live),
      Effect.provide(Host.layer({ root: dir, home: dir, env: process.env })),
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
      { host: "127.0.0.1", cert: certPath, key: keyPath, port: 0, ...(format ? { format } : {}) },
      out,
    ).pipe(
      Effect.provide(UiListener.Live),
      Effect.provide(noCommandRunner),
      Effect.provide(NodeContext.layer),
      Effect.provide(Host.layer({ root: dir, home: dir, env: process.env })),
    ),
  )

  // 15s (300 × 50ms), not `waitForWrites`'s 1s budget above — this poll waits
  // on a REAL bind behind a REAL `openssl`-generated cert (`generateSelfSignedCert`
  // shells out above), which this suite's own full `npm test` (build/lint/
  // test:e2e:live/test:e2e:inmem all racing `test:unit` via turbo) can starve
  // of CPU for real seconds at a time — the same fact
  // `tests/integration/support/world.ts`'s own `UI_BOUND_URL_POLL_ATTEMPTS`
  // documents for the identical class of spawn.
  for (let i = 0; i < 300; i += 1) {
    if (written[0] !== undefined) return { boundUrl: written[0].trim(), fiber }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  // The final wait's own outcome must be checked once more before giving up
  // — the loop's own condition only runs BEFORE each wait, so a bind landing
  // in exactly the last window was previously never observed (see
  // `waitForWrites`'s own comment above for the confusing report this caused).
  if (written[0] !== undefined) return { boundUrl: written[0].trim(), fiber }
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

      // Package 01's Task 3: `view` is now total — an unregistered mode
      // falls back to free-form rendering rather than a typed refusal, so a
      // REAL client dialing a REAL server gets a real view back, not an
      // error at all.
      const viewResult = await client.view.query({ mode: "not-a-real-mode", content: "x" })
      expect(viewResult.view.nodes).not.toEqual([])

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
        note: {
          filePath,
          expectedHeadSha: headSha,
          expectedContentHash: contentHashOf(content),
          mode: "qa",
          anchor: { kind: "paragraph", line: 0 },
          text: "handed back",
        },
      })
      // No `ui.format` is configured for this server, so `contentHash` is
      // just the written bytes' own hash — read straight off disk here
      // rather than hand-computed, so this also proves `done` actually wrote
      // through to the real file before resolving.
      const written = readFileSync(absPath, "utf8")
      expect(result).toEqual({ ok: true, contentHash: contentHashOf(written) })
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

  it("Task 5/6: a configured ui.format runs after the write lands, and the resolved contentHash reflects the FORMATTED bytes on disk", async () => {
    const filePath = "NOTES.md"
    const content = "Paragraph zero here.\n\nParagraph two here.\n"
    // `it.file` renders to the note's absolute path — appends a marker
    // in place, exactly the shape a real `oxfmt --write <%= it.file %>`
    // rewrites a file through.
    const { boundUrl, fiber } = await startRealServer(
      tmpDir,
      "printf -- '<!-- formatted -->\\n' >> <%= it.file %>",
    )
    const absPath = join(tmpDir, filePath)
    writeFileSync(absPath, content)
    execFileSync("git", ["add", "-A"], { cwd: tmpDir })
    execFileSync("git", ["commit", "-q", "-m", "add notes"], { cwd: tmpDir })
    const headSha = await liveHeadSha(tmpDir)
    if (headSha === undefined) throw new Error("liveHeadSha resolved to undefined")

    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const result = await client.writeNote.mutate({
        filePath,
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(content),
        mode: "qa",
        anchor: { kind: "paragraph", line: 0 },
        text: "handed back",
      })
      const onDisk = readFileSync(absPath, "utf8")
      expect(onDisk).toContain("<!-- formatted -->")
      expect(result).toEqual({ ok: true, contentHash: contentHashOf(onDisk) })
    })

    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("Task 5: a failing ui.format command leaves the written bytes on disk, resolves ok, and reports a formatNotice naming the command and its exit code", async () => {
    const filePath = "NOTES.md"
    const content = "Paragraph zero here.\n\nParagraph two here.\n"
    const { boundUrl, fiber } = await startRealServer(tmpDir, "exit 3")
    const absPath = join(tmpDir, filePath)
    writeFileSync(absPath, content)
    execFileSync("git", ["add", "-A"], { cwd: tmpDir })
    execFileSync("git", ["commit", "-q", "-m", "add notes"], { cwd: tmpDir })
    const headSha = await liveHeadSha(tmpDir)
    if (headSha === undefined) throw new Error("liveHeadSha resolved to undefined")

    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const result = await client.writeNote.mutate({
        filePath,
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(content),
        mode: "qa",
        anchor: { kind: "paragraph", line: 0 },
        text: "handed back",
      })
      // The write itself is never reverted or refused by a failing formatter.
      expect(readFileSync(absPath, "utf8")).toContain("handed back")
      expect(result).toMatchObject({
        ok: true,
        formatNotice: { command: "exit 3", exitCode: 3 },
      })
    })

    await Effect.runPromise(Fiber.interrupt(fiber))
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
          note: {
            filePath: "NOTES.md",
            expectedHeadSha: "not-the-real-sha",
            expectedContentHash: "not-the-real-hash",
            mode: "qa",
            anchor: { kind: "paragraph", line: 0 },
            text: "should not land",
          },
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
        note: {
          filePath,
          expectedHeadSha: headSha,
          expectedContentHash: contentHashOf(content),
          mode: "qa",
          anchor: { kind: "paragraph", line: 0 },
          text: "vanishing client",
        },
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

describe("package 02: gtd ui binds on an idle worktree", () => {
  it("the bind itself creates no file — nothing writes .gtd/TODO.md until the human's own write does", async () => {
    const { fiber } = await startRealServer(tmpDir, undefined, idleBeatJson("message"))
    expect(existsSync(join(tmpDir, ".gtd/TODO.md"))).toBe(false)
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("a write that dirties the tree at idle does not trip the moved-on detection — the server keeps serving", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir, undefined, idleBeatJson("message"))
    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const before = await client.step.query()
      expect(before.status).toBe("ok")

      const headSha = await liveHeadSha(tmpDir)
      if (headSha === undefined) throw new Error("liveHeadSha resolved to undefined")
      // `setValue` (`freeform.ts#freeFormApply`), not `writeNote`/`annotate` —
      // an anchor at line 0 against genuinely empty content has no existing
      // block to attach a footnote to, so only `apply`'s own append fallback
      // (an `anchor.line` at/beyond the document's last line) can create the
      // sketch from scratch, exactly what a phone's first-ever write to a
      // never-yet-written `.gtd/TODO.md` needs.
      const result = await client.setValue.mutate({
        filePath: ".gtd/TODO.md",
        expectedHeadSha: headSha,
        expectedContentHash: contentHashOf(""),
        mode: undefined,
        anchor: { kind: "paragraph", line: 0 },
        text: "a sketch from the phone",
      })
      expect(result).toMatchObject({ ok: true })
      expect(readFileSync(join(tmpDir, ".gtd/TODO.md"), "utf8")).toContain(
        "a sketch from the phone",
      )
      expect(execSync("git status --porcelain", { cwd: tmpDir }).toString()).not.toBe("")

      // The fake `gtd` still reports the SAME `state` ("idle") after the
      // write — the server never re-derives anything from the dirtied tree
      // itself, only from what the beat reports — so this read is still
      // `ok`, never `moved-on`.
      const after = await client.step.query()
      expect(after.status).toBe("ok")
    })
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("a kind flip from message to capture (the same flip a dirtied idle worktree reports) does not trip the moved-on detection either", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir, undefined, idleBeatJson("message"))
    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const before = await client.step.query()
      expect(before).toMatchObject({ status: "ok", kind: "message" })

      // Same `state`, different `kind` — exactly what `gtd next --json`
      // reports once the human's own write has landed.
      installFakeGtd(tmpDir, idleBeatJson("capture"))

      const after = await client.step.query()
      expect(after).toMatchObject({ status: "ok", kind: "capture" })
    })
    await Effect.runPromise(Fiber.interrupt(fiber))
  })

  it("hand-off at idle is the existing done with no note: the deferred resolves, the process exits 0, and no write happens", async () => {
    const { boundUrl, fiber } = await startRealServer(tmpDir, undefined, idleBeatJson("message"))
    await withInsecureTls(async () => {
      const client = createTRPCClient<AppRouter>({
        links: [httpBatchLink({ url: `${boundUrl}trpc` })],
      })
      const result = await client.done.mutate({})
      expect(result).toEqual({ ok: true })
    })
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(exit._tag).toBe("Success")
    expect(existsSync(join(tmpDir, ".gtd/TODO.md"))).toBe(false)
  })
})
