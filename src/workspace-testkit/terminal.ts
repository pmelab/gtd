import type { PaneStatus, StatusRecord, TerminalAdapter } from "../workspace/index.js"
import type { ContractCase } from "./index.js"

/** How a probe ends: it waits for `release`, exits with a code, or kills itself. */
export type ProbeEnd =
  | "hold"
  | { readonly exit: number }
  | { readonly signal: "SIGINT" | "SIGTERM" }

export interface ProbeSpec {
  readonly end: ProbeEnd
  /** Arguments after the probe's own command; each must arrive unchanged. */
  readonly args?: readonly string[]
  /**
   * An OSC 7501 root record the probe prints when it starts, followed by a
   * child record (`id=probe`) in another state.
   */
  readonly report?: StatusRecord
}

/** What a probe saw from inside its pane. */
export interface ProbeSight {
  readonly pid: number
  readonly env: Readonly<Record<string, string>>
  readonly args: readonly string[]
}

export interface Probe {
  /** The probe as a command line for `run`. */
  readonly argv: readonly string[]
  /** What the probe saw, `undefined` until it has started. */
  readonly sight: () => Promise<ProbeSight | undefined>
  /** Ends a `hold` probe with exit 0. */
  readonly release: () => Promise<void>
}

/**
 * A fresh terminal for one case, with a worktree to run in and a login shell
 * whose startup files set one variable.
 */
export interface TerminalFixture {
  readonly adapter: TerminalAdapter
  readonly project: string
  /** The worktree path panes run in. */
  readonly worktree: string
  /** A variable the login shell's startup files set. */
  readonly login: { readonly name: string; readonly value: string }
  readonly probe: (spec: ProbeSpec) => Probe
  /** The pid of the pane's own top process, as the terminal knows it. */
  readonly topProcess: (handle: string) => Promise<number | undefined>
  readonly dispose: () => Promise<void>
}

export interface TerminalHarness {
  readonly setup: () => Promise<TerminalFixture>
}

const fail = (message: string): never => {
  throw new Error(message)
}

const withFixture =
  (harness: TerminalHarness, body: (fixture: TerminalFixture) => Promise<void>) =>
  async (): Promise<void> => {
    const fixture = await harness.setup()
    try {
      await body(fixture)
    } finally {
      await fixture.dispose()
    }
  }

const until = async <A>(
  what: string,
  probe: () => Promise<A | undefined>,
  timeoutMs = 15_000,
): Promise<A> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) return fail(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const exited = (fixture: TerminalFixture, handle: string): Promise<PaneStatus> =>
  until("the command to exit", async () => {
    const status = await fixture.adapter.status(handle)
    if (status === undefined) return fail("the pane is gone after its command exited")
    return status.exit === null ? undefined : status
  })

const started = async (fixture: TerminalFixture, spec: ProbeSpec, env = {}) => {
  const probe = fixture.probe(spec)
  const handle = await fixture.adapter.run(fixture.project, fixture.worktree, probe.argv, env)
  const sight = await until("the command to start", probe.sight)
  return { probe, handle, sight }
}

const exitCase = (label: string, end: ProbeEnd, code: number) => (harness: TerminalHarness) => ({
  name: `status() reports exit ${code} when the command ${label}`,
  run: withFixture(harness, async (fixture) => {
    const { handle } = await started(fixture, { end })
    const status = await exited(fixture, handle)
    if (status.alive) fail("a command that exited is reported alive")
    if (status.exit?.code !== code) fail(`exit is ${JSON.stringify(status.exit)}, not ${code}`)
  }),
})

const within = <A>(ms: number, promise: Promise<A>, what: string): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} within ${ms} ms`)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

const RETURN_WAIT_MS = 5_000

const HOSTILE_ARGS = ["two words", "$HOME", "it's", '"quoted"', "`id`", "a;b|c&", "--", "x=y", "*"]

/** The cases every terminal adapter passes, bundled or userland. */
export const terminalContract = (harness: TerminalHarness): readonly ContractCase[] => [
  {
    name: "argv is the pane's top process, with no wrapper above it",
    run: withFixture(harness, async (fixture) => {
      const { probe, handle, sight } = await started(fixture, { end: "hold" })
      const top = await fixture.topProcess(handle)
      if (top !== sight.pid)
        fail(`the pane's top process is ${top}, the command runs as ${sight.pid}`)
      const status = await fixture.adapter.status(handle)
      if (status?.alive !== true || status.exit !== null) {
        fail(`a running command is reported as ${JSON.stringify(status)}`)
      }
      await probe.release()
      await exited(fixture, handle)
    }),
  },
  {
    name: "each argument arrives as one argument, unchanged",
    run: withFixture(harness, async (fixture) => {
      const { sight } = await started(fixture, { end: { exit: 0 }, args: HOSTILE_ARGS })
      if (JSON.stringify(sight.args) !== JSON.stringify(HOSTILE_ARGS)) {
        fail(`the command got ${JSON.stringify(sight.args)}`)
      }
    }),
  },
  {
    name: "argv sees a variable that the login shell's startup files set",
    run: withFixture(harness, async (fixture) => {
      const { sight } = await started(fixture, { end: { exit: 0 } })
      const { name, value } = fixture.login
      if (sight.env[name] !== value)
        fail(`${name} is ${JSON.stringify(sight.env[name])}, not "${value}"`)
    }),
  },
  {
    name: "gtd's variables win over the login shell's startup files",
    run: withFixture(harness, async (fixture) => {
      const env = { [fixture.login.name]: "set by gtd", GTD_CONTRACT: "a b $HOME 'q' `id`" }
      const { sight } = await started(fixture, { end: { exit: 0 } }, env)
      for (const [name, value] of Object.entries(env)) {
        if (sight.env[name] !== value) {
          fail(`${name} is ${JSON.stringify(sight.env[name])}, not ${JSON.stringify(value)}`)
        }
      }
    }),
  },
  exitCase("exits 0", { exit: 0 }, 0)(harness),
  exitCase("crashes with exit 3", { exit: 3 }, 3)(harness),
  exitCase("is killed by SIGINT", { signal: "SIGINT" }, 130)(harness),
  exitCase("is killed by SIGTERM", { signal: "SIGTERM" }, 143)(harness),
  {
    name: "the pane stays after its command exits, until close()",
    run: withFixture(harness, async (fixture) => {
      const { handle } = await started(fixture, { end: { exit: 3 } })
      await exited(fixture, handle)
      await fixture.adapter.close(handle)
      const status = await fixture.adapter.status(handle)
      if (status !== undefined) fail(`a closed pane reports ${JSON.stringify(status)}`)
    }),
  },
  {
    name: "status() reports the root OSC 7501 record, not a child record",
    run: withFixture(harness, async (fixture) => {
      const report = { state: "blocked", kind: "question", title: "Answer the plan" }
      const { probe, handle } = await started(fixture, { end: "hold", report })
      const record = await until("the root record", async () => {
        const status = await fixture.adapter.status(handle)
        return status?.record
      })
      const { state, kind, title, msg } = record
      if (
        JSON.stringify({ state, kind, title, msg }) !==
        JSON.stringify({ ...report, msg: undefined })
      ) {
        fail(`the record is ${JSON.stringify(record)}`)
      }
      await probe.release()
    }),
  },
  {
    name: "watch() ends when its consumer stops, even while it waits for a hint",
    run: withFixture(harness, async (fixture) => {
      if (fixture.adapter.watch === undefined) return
      const hints = fixture.adapter.watch()[Symbol.asyncIterator]()
      const waiting = hints.next()
      await within(RETURN_WAIT_MS, Promise.resolve(hints.return?.()), "return() did not resolve")
      const result = await within(RETURN_WAIT_MS, waiting, "the waiting next() did not end")
      if (result.done !== true) fail("the waiting next() gave a hint instead of ending")
    }),
  },
]
