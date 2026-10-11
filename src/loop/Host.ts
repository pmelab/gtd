import { spawn } from "node:child_process"
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { constants } from "node:os"
import { dirname } from "node:path"
import { Context, Effect, Layer } from "effect"

interface Spawn {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly stdin?: string
  /** Layered over the loop's own environment. */
  readonly env?: Readonly<Record<string, string>>
  /** `log` appends stdout and stderr to that file as they arrive, so `tail -f` follows a long check live. */
  readonly output: "capture" | { readonly log: string }
}

export interface Exit {
  /** A signal death reads as 128 + signal number, as a shell reports it. */
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Everything the loop does to the outside world: subprocesses, its log file, and stderr. */
export class LoopHost extends Context.Tag("LoopHost")<
  LoopHost,
  {
    readonly env: Readonly<Record<string, string | undefined>>
    readonly color: boolean
    /** A spawn failure (no such binary) fails the Effect; a non-zero exit is a value. */
    readonly spawn: (request: Spawn) => Effect.Effect<Exit, Error>
    /** `undefined` for a missing file; any other read failure fails. */
    readonly readFile: (path: string) => Effect.Effect<string | undefined, Error>
    readonly resetLog: (path: string) => Effect.Effect<void, Error>
    readonly appendLog: (path: string, text: string) => Effect.Effect<void>
    readonly say: (text: string) => Effect.Effect<void>
  }
>() {}

// How long an interrupted child's process group gets to exit after SIGTERM.
const KILL_GRACE_MS = 5_000

const spawnLive = (request: Spawn): Effect.Effect<Exit, Error> =>
  Effect.async<Exit, Error>((resume) => {
    const logFd = request.output === "capture" ? undefined : openSync(request.output.log, "a")
    // Its own process group, so an interruption can stop everything a script
    // or turn started, not just the shell the loop spawned.
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: { ...process.env, ...request.env },
      stdio: [request.stdin === undefined ? "ignore" : "pipe", logFd ?? "pipe", logFd ?? "pipe"],
      detached: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf-8").on("data", (chunk: string) => (stdout += chunk))
    child.stderr?.setEncoding("utf-8").on("data", (chunk: string) => (stderr += chunk))
    // A child that exits before reading all of stdin is not an error of ours.
    child.stdin?.on("error", () => {})
    child.stdin?.end(request.stdin)
    // Node emits `close` after a spawn `error` too: settle and close the log once.
    let settled = false
    const settle = (exit: Effect.Effect<Exit, Error>): void => {
      if (settled) return
      settled = true
      if (logFd !== undefined) closeSync(logFd)
      resume(exit)
    }
    child.on("error", (error) =>
      settle(Effect.fail(new Error(`could not run ${request.command}: ${error.message}`))),
    )
    child.on("close", (code, signal) => {
      const exit = code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0))
      settle(Effect.succeed({ code: exit, stdout, stderr }))
    })
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal)
      } catch {
        // The group is already gone.
      }
    }
    return Effect.async<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
        killGroup("SIGTERM")
        done(Effect.void)
        return
      }
      const force = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS)
      child.once("exit", () => {
        clearTimeout(force)
        // The shell is gone; take whatever it left running with it.
        killGroup("SIGKILL")
        done(Effect.void)
      })
      killGroup("SIGTERM")
    })
  })

export const liveLoopHost: Layer.Layer<LoopHost> = Layer.succeed(LoopHost, {
  env: process.env,
  color: process.stderr.isTTY === true && process.env["NO_COLOR"] === undefined,
  spawn: spawnLive,
  readFile: (path) =>
    Effect.try({
      try: () => {
        try {
          return readFileSync(path, "utf-8")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
          throw error
        }
      },
      catch: (error) => new Error(`could not read ${path}: ${String(error)}`),
    }),
  resetLog: (path) =>
    Effect.try({
      try: () => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, "")
      },
      catch: (error) => new Error(`could not reset the loop log ${path}: ${String(error)}`),
    }),
  appendLog: (path, text) => Effect.sync(() => appendFileSync(path, text)),
  say: (text) => Effect.sync(() => process.stderr.write(text)),
})
