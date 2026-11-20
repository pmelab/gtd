import { execFile } from "node:child_process"
import { AdapterError, type Service, type ServicesAdapter } from "../workspace/index.js"

export interface PitchforkOptions {
  /** The `pitchfork` executable. */
  readonly bin?: string
  /** Replaces the port of every service URL that has one (the default port drops). */
  readonly publicPort?: number
}

// Matches the port in the raw authority: `URL.port` is empty for a default port.
const AUTHORITY_PORT = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*):\d+(?=[/?#]|$)/i

const withPort = (url: string, port: number): string => {
  const m = AUTHORITY_PORT.exec(url)
  if (m === null) return url
  const [whole, head = ""] = m
  const rest = url.slice(whole.length)
  try {
    // The scheme's default port is left out of the link.
    return new URL(`${head}:${port}${rest}`).port === "" ? head + rest : `${head}:${port}${rest}`
  } catch {
    return url
  }
}

interface Ran {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

const run = (command: string, args: readonly string[], cwd: string): Promise<Ran> =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = (error as NodeJS.ErrnoException | null)?.code
      resolve({
        status: error === null ? 0 : typeof code === "number" ? code : 127,
        stdout,
        stderr: error !== null && typeof code !== "number" ? error.message : stderr,
      })
    })
  })

interface Daemon {
  readonly namespace?: string
  readonly name?: string
  readonly status?: string
  readonly url?: string | null
  readonly error?: string | null
}

const FAILED = new Set(["failed", "errored"])

const failure = (op: string, message: string, detail?: unknown): AdapterError =>
  new AdapterError({
    adapter: "services",
    op,
    message,
    ...(detail !== undefined && detail !== "" ? { detail } : {}),
  })

const serviceOf = (daemon: Daemon, publicPort?: number): Service => ({
  name: daemon.name!,
  url:
    typeof daemon.url === "string" && daemon.url !== ""
      ? publicPort === undefined
        ? daemon.url
        : withPort(daemon.url, publicPort)
      : undefined,
  running: daemon.status === "running",
  error:
    typeof daemon.error === "string" && daemon.error !== ""
      ? daemon.error
      : FAILED.has(daemon.status ?? "")
        ? daemon.status
        : undefined,
})

/**
 * The bundled services adapter: the pitchfork daemons of the worktree's own
 * `pitchfork.toml`. A worktree's services are its namespace's daemons, so one
 * worktree's `up` and `down` leave the others alone.
 */
export const pitchfork = (options: PitchforkOptions = {}): ServicesAdapter => {
  const bin = options.bin ?? "pitchfork"
  const { publicPort } = options
  if (
    publicPort !== undefined &&
    (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535)
  ) {
    throw new Error(`pitchfork: publicPort must be an integer from 1 to 65535, got ${publicPort}`)
  }
  return {
    list: async (_project, worktree) => {
      const listed = await run(bin, ["list", "--json", "--project"], worktree)
      if (listed.status !== 0) {
        throw failure("list", `pitchfork list failed in ${worktree}`, listed.stderr.trim())
      }
      let daemons: unknown
      try {
        daemons = JSON.parse(listed.stdout)
      } catch {
        throw failure("list", "pitchfork list printed no JSON", listed.stdout)
      }
      if (!Array.isArray(daemons)) throw failure("list", "pitchfork list printed no list")
      // Outside any pitchfork.toml, `--project` means the global namespace,
      // whose daemons belong to no worktree.
      return (daemons as Daemon[])
        .filter((d) => typeof d.name === "string" && d.namespace !== "global")
        .map((d) => serviceOf(d, publicPort))
    },
    up: async (_project, worktree) => {
      const started = await run(bin, ["start", "--local", "--quiet"], worktree)
      if (started.status !== 0) {
        throw failure("up", `pitchfork start failed in ${worktree}`, started.stderr.trim())
      }
    },
    down: async (_project, worktree) => {
      const stopped = await run(bin, ["stop", "--local"], worktree)
      if (stopped.status !== 0) {
        throw failure("down", `pitchfork stop failed in ${worktree}`, stopped.stderr.trim())
      }
    },
  }
}
