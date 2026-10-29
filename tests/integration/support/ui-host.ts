import { join, relative } from "node:path"
import { Effect, Layer } from "effect"
import {
  UiHost,
  UiListener,
  UiShell,
  type ServeRecord,
  type SpawnOutcome,
  type UiHandler,
  type UiHostOps,
} from "../../../src/ui/index.js"
import type { InMemRepo } from "../../../src/twins/index.js"
import type { GtdRun } from "./lsp-io.js"

/** What a `tailscale` CLI would hold: the published serve mappings, by port. */
export interface FakeTailnet {
  readonly mappings: Map<number, string>
  /** Every later `serve --bg` fails while set. */
  failPublish: boolean
}

const TAILNET_HOST = "test-node.tailnet.ts.net"

/** The CLI the live tier's fake `tailscale` script answers as, in memory. */
const tailscale = (tailnet: FakeTailnet, command: string): { status: number; output: string } => {
  if (command === "tailscale status --json") {
    return {
      status: 0,
      output: JSON.stringify({
        BackendState: "Running",
        CertDomains: [TAILNET_HOST],
        Self: { DNSName: `${TAILNET_HOST}.` },
      }),
    }
  }
  if (command === "tailscale serve status --json") {
    const web = Object.fromEntries(
      [...tailnet.mappings].map(([port, target]) => [
        `${TAILNET_HOST}:${port}`,
        { Handlers: { "/": { Proxy: target } } },
      ]),
    )
    return { status: 0, output: JSON.stringify({ Web: web }) }
  }
  const port = Number(/--https=(\d+)/.exec(command)?.[1])
  if (command.startsWith("tailscale serve --bg ")) {
    if (tailnet.failPublish) return { status: 1, output: "tailscale: simulated publish failure\n" }
    tailnet.mappings.set(port, /'(http:[^']+)'/.exec(command)![1]!)
    return { status: 0, output: "" }
  }
  if (command.startsWith("tailscale serve ") && command.endsWith(" off")) {
    tailnet.mappings.delete(port)
    return { status: 0, output: "" }
  }
  return { status: 1, output: `fake tailscale: unsupported invocation: ${command}\n` }
}

/**
 * The `bash` `gtd ui` runs, in memory: openssl writes a placeholder pair into
 * the scratch files — the in-memory listener terminates no TLS — and
 * tailscale answers from `tailnet`.
 */
const shell = (tailnet: FakeTailnet, scratch: Map<string, string>) =>
  UiShell.layer((command) =>
    Effect.sync(() => {
      const openssl = /-keyout '([^']+)' -out '([^']+)'/.exec(command)
      if (command.startsWith("openssl req ") && openssl !== null) {
        scratch.set(openssl[1]!, "-----BEGIN PRIVATE KEY-----\nin-memory\n")
        scratch.set(openssl[2]!, "-----BEGIN CERTIFICATE-----\nin-memory\n")
        return { status: 0, output: "" }
      }
      const outcome = command.startsWith("tailscale ")
        ? tailscale(tailnet, command)
        : { status: 127, output: `sh: ${command.split(" ")[0]}: not found\n` }
      return { ...outcome, stdout: outcome.output }
    }),
  )

let scratchDirs = 0

/**
 * The worktree and machine `gtd ui` sees, answered from an in-memory
 * repository rooted at `root`: gtd itself runs in-process through `gtd`, a
 * format command on the in-memory shell through `sh`, and the machine has
 * no network interfaces and only this process alive.
 */
export const inMemoryUiHost = (
  root: string,
  repo: InMemRepo,
  options: {
    readonly gtd: (...args: string[]) => Promise<GtdRun>
    readonly sh: (script: string) => Promise<{ exitCode: number; output: string }>
    readonly serveRecords: Map<number, ServeRecord>
    readonly scratch: Map<string, string>
  },
): UiHostOps => {
  const local = (absPath: string): string => relative(root, absPath)
  const run = async (_cwd: string, command: string): Promise<SpawnOutcome> => {
    if (/^gtd( |$)/.test(command)) {
      const result = await options.gtd(...command.split(/\s+/).slice(1))
      return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr }
    }
    try {
      const result = await options.sh(command.replaceAll(`'${root}/`, "'"))
      return { status: result.exitCode, stdout: result.output, stderr: "" }
    } catch (error) {
      return {
        status: 127,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }
    }
  }
  return {
    run,
    headSha: async () => repo.resolveRef("HEAD") ?? undefined,
    readLocalGtdVersion: async (path) => {
      const raw = repo.readFile(local(join(path, "node_modules/@pmelab/gtd/package.json")))
      try {
        const version =
          raw === undefined ? undefined : (JSON.parse(raw) as { version?: unknown }).version
        return typeof version === "string" ? version : undefined
      } catch {
        return undefined
      }
    },
    readFile: async (absPath) => {
      const content = repo.readFile(local(absPath))
      if (content !== undefined) return { kind: "content", content }
      return repo.hasPath(local(absPath)) ? { kind: "unreadable" } : { kind: "absent" }
    },
    writeFile: async (absPath, content) => repo.writeFile(local(absPath), content),
    networkInterfaces: () => ({}),
    serveRecords: {
      read: (port) => options.serveRecords.get(port),
      write: (port, record) => void options.serveRecords.set(port, record),
      delete: (port) => void options.serveRecords.delete(port),
    },
    isPidAlive: (pid) => pid === process.pid,
    scratch: (body) => {
      const dir = `/inmem-scratch/${++scratchDirs}`
      const read = (name: string): string => {
        const content = options.scratch.get(join(dir, name))
        if (content === undefined)
          throw new Error(`ENOENT: no such file, open '${join(dir, name)}'`)
        return content
      }
      return body(dir, read).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const path of options.scratch.keys())
              if (path.startsWith(`${dir}/`)) options.scratch.delete(path)
          }),
        ),
      )
    },
  }
}

let loopbackPorts = 41000

/** Every layer `gtd ui` needs in memory; `onListen` receives the server's handler once it binds. */
export const inMemoryUiLayers = (
  host: UiHostOps,
  tailnet: FakeTailnet,
  scratch: Map<string, string>,
  onListen: (handler: UiHandler) => void,
): Layer.Layer<UiHost | UiShell | UiListener> =>
  Layer.mergeAll(
    Layer.succeed(UiHost, host),
    shell(tailnet, scratch),
    Layer.succeed(UiListener, {
      listen: ({ handler, port }) =>
        Effect.sync(() => {
          onListen(handler)
          return { port: port === 0 ? ++loopbackPorts : port, close: () => {} }
        }),
    }),
  )
