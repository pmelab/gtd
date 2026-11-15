import { execFile } from "node:child_process"
import { AdapterError, type Service, type ServicesAdapter } from "../workspace/index.js"

export interface PitchforkOptions {
  /** The `pitchfork` executable. */
  readonly bin?: string
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

const serviceOf = (daemon: Daemon): Service => ({
  name: daemon.name!,
  url: typeof daemon.url === "string" && daemon.url !== "" ? daemon.url : undefined,
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
        .map(serviceOf)
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
