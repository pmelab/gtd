import type { PaneStatus, StatusRecord, TerminalAdapter } from "../workspace/index.js"
import type { ProbeSight, TerminalHarness } from "../workspace-testkit/index.js"

export interface InMemoryPane {
  readonly handle: string
  readonly project: string
  readonly worktree: string
  readonly argv: readonly string[]
  /** The environment the command sees: the login shell's, then gtd's on top. */
  readonly env: Readonly<Record<string, string>>
  readonly pid: number
  record: StatusRecord | undefined
  exit: { readonly code: number } | null
  busy: boolean
}

/** What a scripted program does once its pane starts it. */
export type InMemoryProgram = (process: {
  readonly pid: number
  readonly env: Readonly<Record<string, string>>
  readonly args: readonly string[]
  readonly report: (record: StatusRecord) => void
  readonly exit: (code: number) => void
}) => void

export interface InMemoryTerminal {
  readonly adapter: TerminalAdapter
  /** Every pane ever opened, closed ones included, oldest first. */
  readonly panes: () => readonly InMemoryPane[]
  /** The handles `focus` was called with, oldest first. */
  readonly focused: () => readonly string[]
  /** The program in the pane reports a root OSC 7501 record. */
  readonly report: (handle: string, record: StatusRecord) => void
  /** The pane's command exits; the terminal drops a `working` or `blocked` record then. */
  readonly exit: (handle: string, code: number) => void
  /** The pane is lost with its terminal, as after a reboot. */
  readonly lose: (handle: string) => void
}

export interface InMemoryTerminalOptions {
  /** What the login shell's startup files set. */
  readonly loginEnv?: Readonly<Record<string, string>>
  /** The program `argv` names; a command it does not know runs until `exit`. */
  readonly programs?: (argv: readonly string[]) => InMemoryProgram | undefined
}

/** The terminal adapter's twin: panes as records that a test drives. */
export const inMemoryTerminal = (options: InMemoryTerminalOptions = {}): InMemoryTerminal => {
  const panes = new Map<string, InMemoryPane>()
  const closed = new Set<string>()
  const focused: string[] = []
  let opened = 0

  const streams = new Set<{ handles: string[]; ended: boolean; wake: () => void }>()
  const hint = (handle: string): void => {
    for (const stream of streams) {
      stream.handles.push(handle)
      stream.wake()
    }
  }

  const live = (handle: string): InMemoryPane | undefined =>
    closed.has(handle) ? undefined : panes.get(handle)
  const paneOf = (handle: string): InMemoryPane => {
    const pane = live(handle)
    if (pane === undefined) throw new Error(`no pane ${handle}`)
    return pane
  }
  const exit = (handle: string, code: number): void => {
    const pane = paneOf(handle)
    if (pane.exit !== null) return
    pane.exit = { code }
    pane.busy = false
    if (pane.record?.state === "working" || pane.record?.state === "blocked") {
      pane.record = undefined
    }
    hint(handle)
  }
  const report = (handle: string, record: StatusRecord): void => {
    paneOf(handle).record = record
    hint(handle)
  }

  const adapter: TerminalAdapter = {
    run: async (project, worktree, argv, env) => {
      const handle = `pane-${++opened}`
      const pane: InMemoryPane = {
        handle,
        project,
        worktree,
        argv: [...argv],
        env: { ...options.loginEnv, ...env },
        pid: 1000 + opened,
        record: undefined,
        exit: null,
        busy: false,
      }
      panes.set(handle, pane)
      options.programs?.(argv)?.({
        pid: pane.pid,
        env: pane.env,
        args: argv.slice(1),
        report: (record) => report(handle, record),
        exit: (code) => exit(handle, code),
      })
      return handle
    },
    status: async (handle) => {
      const pane = live(handle)
      if (pane === undefined) return undefined
      const status: PaneStatus = {
        record: pane.record,
        alive: pane.exit === null,
        busy: pane.busy,
        exit: pane.exit,
      }
      return status
    },
    close: async (handle) => {
      closed.add(handle)
      hint(handle)
    },
    focus: async (handle) => {
      paneOf(handle)
      focused.push(handle)
    },
    // Hand-written so that `return()` ends a stream whose `next()` still waits.
    watch: () => ({
      [Symbol.asyncIterator]: () => {
        const stream = { handles: [] as string[], ended: false, wake: () => {} }
        streams.add(stream)
        return {
          next: async (): Promise<IteratorResult<string>> => {
            while (stream.handles.length === 0 && !stream.ended) {
              await new Promise<void>((resolve) => (stream.wake = resolve))
            }
            const value = stream.handles.shift()
            return value === undefined ? { done: true, value: undefined } : { done: false, value }
          },
          return: async (): Promise<IteratorResult<string>> => {
            stream.ended = true
            streams.delete(stream)
            stream.wake()
            return { done: true, value: undefined }
          },
        }
      },
    }),
  }

  return {
    adapter,
    panes: () => [...panes.values()],
    focused: () => focused,
    report,
    exit,
    lose: (handle) => {
      closed.add(handle)
      hint(handle)
    },
  }
}

const SIGNAL_CODES = { SIGINT: 130, SIGTERM: 143 } as const

/** The contract kit's harness for the twin: probes are scripted programs. */
export const inMemoryTerminalHarness: TerminalHarness = {
  setup: async () => {
    const programs: Map<string, InMemoryProgram> = new Map()
    const twin = inMemoryTerminal({
      loginEnv: { GTD_CONTRACT_LOGIN: "from the startup files" },
      programs: (argv) => programs.get(argv[0] ?? ""),
    })
    return {
      adapter: twin.adapter,
      project: "demo",
      worktree: "/workspace/demo",
      login: { name: "GTD_CONTRACT_LOGIN", value: "from the startup files" },
      probe: (spec) => {
        const name = `probe-${programs.size + 1}`
        const state: { sight?: ProbeSight; release: () => void } = { release: () => {} }
        programs.set(name, (process) => {
          state.sight = { pid: process.pid, env: process.env, args: process.args }
          if (spec.report !== undefined) process.report(spec.report)
          const { end } = spec
          if (end === "hold") state.release = () => process.exit(0)
          else process.exit("exit" in end ? end.exit : SIGNAL_CODES[end.signal])
        })
        return {
          argv: [name, ...(spec.args ?? [])],
          sight: async () => state.sight,
          release: async () => state.release(),
        }
      },
      topProcess: async (handle) => twin.panes().find((p) => p.handle === handle)?.pid,
      dispose: async () => {},
    }
  },
}
