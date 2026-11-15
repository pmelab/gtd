import { execFile, spawn } from "node:child_process"
import { basename } from "node:path"
import {
  AdapterError,
  type PaneStatus,
  type StatusRecord,
  type TerminalAdapter,
} from "../workspace/index.js"

export interface RexOptions {
  /** The Rex server, as `rex -S` takes it; the default server when absent. */
  readonly server?: string
  /** The login shell whose environment a pane gets; Rex's default when absent. */
  readonly shell?: string
  /** The `rex` executable. */
  readonly bin?: string
}

interface Outcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface RexProcess {
  readonly child?: { readonly pid: number } | null
  readonly foreground?: { readonly pid: number } | null
  readonly last_exit?: { readonly exit_code: number; readonly error?: string } | null
}

interface RexRecord extends StatusRecord {
  readonly id?: string
}

// Go's names for the signals that end a process, as Rex reports them in
// `last_exit.error` ("signal: interrupt"); the numbers agree on Linux and macOS.
const SIGNALS: Readonly<Record<string, number>> = {
  hangup: 1,
  interrupt: 2,
  quit: 3,
  "illegal instruction": 4,
  "trace/breakpoint trap": 5,
  aborted: 6,
  "floating point exception": 8,
  killed: 9,
  "segmentation fault": 11,
  "broken pipe": 13,
  "alarm clock": 14,
  terminated: 15,
}

const exitCode = (last: NonNullable<RexProcess["last_exit"]>): number => {
  if (last.exit_code >= 0) return last.exit_code
  const signal = /^signal: (.+)$/.exec(last.error ?? "")?.[1]
  const number = signal === undefined ? undefined : SIGNALS[signal]
  return number === undefined ? last.exit_code : 128 + number
}

const rootRecord = (records: readonly RexRecord[]): StatusRecord | undefined => {
  const root = records.find((r) => r.id === undefined || r.id === "")
  if (root === undefined) return undefined
  const { state, kind, title, msg } = root
  return {
    state,
    ...(kind === undefined ? {} : { kind }),
    ...(title === undefined ? {} : { title }),
    ...(msg === undefined ? {} : { msg }),
  }
}

const paneStatus = (process: RexProcess, records: readonly RexRecord[]): PaneStatus => {
  const last = process.last_exit ?? null
  const { child, foreground } = process
  return {
    record: rootRecord(records),
    alive: last === null,
    busy: last === null && foreground != null && child != null && foreground.pid !== child.pid,
    exit: last === null ? null : { code: exitCode(last) },
  }
}

const isGone = (outcome: Outcome): boolean => outcome.code !== 0 && /not found/.test(outcome.stderr)

// The pane's command must be argv itself: `env` sets gtd's variables after
// the login shell's startup files have run, then execs argv in its place.
const withEnv = (argv: readonly string[], env: Readonly<Record<string, string>>): string[] => [
  "env",
  "--",
  ...Object.entries(env).map(([name, value]) => `${name}=${value}`),
  ...argv,
]

const BLOCK_EVENTS: ReadonlySet<string> = new Set([
  "program_status_changed",
  "program_status_removed",
  "process_changed",
  "child_exited",
])

/** The pane handle a `rex events --json` line names, when the line changes a pane's status. */
export const changedPane = (line: string): string | undefined => {
  let event: { type?: string; payload?: { event?: { type?: string; payload?: unknown } } }
  try {
    event = JSON.parse(line) as typeof event
  } catch {
    return undefined
  }
  const inner = event.payload?.event
  if (event.type !== "session_event" || inner === undefined) return undefined
  const payload = inner.payload as { block_id?: string; name?: string } | undefined
  if (inner.type === "block_closed") return payload?.block_id
  if (inner.type === "block_event" && BLOCK_EVENTS.has(payload?.name ?? "")) {
    return payload?.block_id
  }
  return undefined
}

/**
 * The terminal adapter over Rex. Each project is a Rex session; each `run`
 * opens a new window there whose terminal runs argv through the login shell
 * and keeps the pane open after argv exits. A handle is the block id.
 */
export const rex = (options: RexOptions = {}): TerminalAdapter => {
  const bin = options.bin ?? "rex"
  const global = (autostart: boolean): string[] => [
    ...(options.server === undefined ? [] : ["-S", options.server]),
    ...(autostart ? [] : ["--autostart=false"]),
  ]
  const call = (args: readonly string[], autostart = false): Promise<Outcome> =>
    new Promise((resolve) => {
      execFile(
        bin,
        [...global(autostart), ...args],
        { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1
          resolve({ code, stdout, stderr: stderr || (error?.message ?? "") })
        },
      )
    })
  const fail = (op: string, outcome: Outcome): never => {
    throw new AdapterError({
      adapter: "terminal",
      op,
      message: `rex: ${outcome.stderr.trim().split("\n")[0] || `exit ${outcome.code}`}`,
      detail: { exitCode: outcome.code, stderr: outcome.stderr },
    })
  }
  const json = <A>(op: string, outcome: Outcome): A => {
    if (outcome.code !== 0) return fail(op, outcome)
    try {
      return JSON.parse(outcome.stdout) as A
    } catch {
      return fail(op, { ...outcome, stderr: `not JSON: ${outcome.stdout}` })
    }
  }
  const terminalFlags = (cwd: string): string[] => [
    "--json",
    "--keep-open",
    "--interactive",
    ...(options.shell === undefined ? [] : ["--shell", options.shell]),
    "-c",
    cwd,
  ]

  return {
    run: async (project, worktree, argv, env) => {
      const command = ["--", ...withEnv(argv, env)]
      const label = basename(worktree)
      const { sessions } = json<{ sessions: readonly { label: string }[] }>(
        "run",
        await call(["session", "ls", "--json"], true),
      )
      const exists = sessions.some((s) => s.label.toLowerCase() === project.toLowerCase())
      if (exists) {
        const created = json<{ block_ids?: readonly string[] }>(
          "run",
          await call(
            [
              "run",
              "-s",
              project,
              "--focus=false",
              "--label",
              label,
              ...terminalFlags(worktree),
              ...command,
            ],
            true,
          ),
        )
        return created.block_ids?.[0] ?? fail("run", { code: 0, stdout: "", stderr: "no block id" })
      }
      const created = json<{ initial_windows?: readonly { block_ids?: readonly string[] }[] }>(
        "run",
        await call(
          ["new", project, "--window", label, ...terminalFlags(worktree), ...command],
          true,
        ),
      )
      return (
        created.initial_windows?.[0]?.block_ids?.[0] ??
        fail("run", { code: 0, stdout: "", stderr: "no block id" })
      )
    },
    status: async (handle) => {
      const processOutcome = await call(["block", "call", "-b", handle, "process"])
      if (isGone(processOutcome)) return undefined
      const process = json<RexProcess>("status", processOutcome)
      const recordsOutcome = await call(["block", "call", "-b", handle, "program_status"])
      if (isGone(recordsOutcome)) return undefined
      const { records } = json<{ records?: readonly RexRecord[] }>("status", recordsOutcome)
      return paneStatus(process, records ?? [])
    },
    close: async (handle) => {
      const outcome = await call(["block", "close", handle])
      if (outcome.code !== 0 && !isGone(outcome)) fail("close", outcome)
    },
    watch: () => ({
      [Symbol.asyncIterator]: async function* () {
        const events = spawn(bin, [...global(false), "events", "--all", "--json"], {
          stdio: ["ignore", "pipe", "ignore"],
        })
        try {
          let pending = ""
          for await (const chunk of events.stdout) {
            const lines = (pending + String(chunk)).split("\n")
            pending = lines.pop() ?? ""
            for (const line of lines) {
              const handle = changedPane(line)
              if (handle !== undefined) yield handle
            }
          }
        } finally {
          events.kill()
        }
      },
    }),
  }
}
