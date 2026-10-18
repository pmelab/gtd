import { spawn } from "node:child_process"
import { type FlagDeclaration } from "../src/flags/index.ts"

export const TASKS = [
  "format:check",
  "typecheck",
  "lint",
  "lint:sh",
  "lint:boundaries",
  "test:unit",
  "test:workflows",
  "test:e2e:inmem",
  "test:e2e:live",
  "test:web",
  "analyze",
] as const

export const VITEST_TASKS = TASKS.filter((t) => t.startsWith("test:"))

type Env = Readonly<Record<string, string | undefined>>

export interface TestState {
  /** "defaults", or "<name> on" / "<name> off" for the one flag flipped from its default. */
  readonly label: string
  readonly tasks: readonly string[]
  readonly env: Env
}

export interface RunResult {
  readonly status: number | null
  readonly output: string
}

/** A bare status carries no output, so a failure it reports can never match or differ. */
export type RunTasks = (
  tasks: readonly string[],
  env: Env,
  /** Stream the state's output to the terminal as it runs; otherwise it is only captured. */
  live: boolean,
) => number | null | RunResult | Promise<number | null | RunResult>

export function planStates(registry: readonly FlagDeclaration[], env: Env): readonly TestState[] {
  // Every release flag is pinned explicitly: a default-on flag's shipped path must be tested,
  // and an inherited GTD_FLAG_* must never leak.
  const inherited = Object.fromEntries(Object.entries(env).filter(([k]) => !/^GTD_FLAG_/.test(k)))
  const releases = registry.filter((f) => f.kind === "release")
  const pinned = (flipped?: string): Env => ({
    ...inherited,
    ...Object.fromEntries(
      releases.map(({ name, defaultOn }) => {
        const on = (defaultOn ?? false) !== (name === flipped)
        return [`GTD_FLAG_${name.toUpperCase()}`, on ? "1" : "0"]
      }),
    ),
  })
  return [
    { label: "defaults", tasks: TASKS, env: pinned() },
    ...releases.map(({ name, defaultOn }) => ({
      label: `${name} ${defaultOn ? "off" : "on"}`,
      tasks: VITEST_TASKS,
      env: pinned(name),
    })),
  ]
}

const ANSI = /\u001b\[[0-9;]*m/g // eslint-disable-line no-control-regex
const stripAnsi = (text: string): string => text.replace(ANSI, "")

/** Failed task -> sorted failing test names, read from turbo's `Failed:` line and prefixed vitest output. */
export function failuresOf(
  output: string,
  tasks: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const lines = stripAnsi(output).split("\n")
  const failed = lines.flatMap((l) => {
    const m = /^Failed:\s+(.*)$/.exec(l)
    return m ? m[1]!.split(",").map((t) => t.trim().replace(/^.*#/, "")) : []
  })
  const tests = new Map<string, string[]>(failed.map((t) => [t, []]))
  for (const line of lines) {
    const task = taskOf(line, tasks)
    const m =
      task && tests.has(task)
        ? /^\s*FAIL\s+(.*?)(?:\s+\[.*\])?\s*$/.exec(line.slice(task.length + 2))
        : null
    if (m) tests.get(task!)!.push(m[1]!)
  }
  return new Map([...tests].map(([t, names]) => [t, [...new Set(names)].sort()]))
}

// Longest first: `test:e2e:inmem` must win over a `test:e2e` prefix.
const taskOf = (line: string, tasks: readonly string[]): string | undefined =>
  [...tasks].sort((a, b) => b.length - a.length).find((t) => line.startsWith(`${t}: `))

const sameTests = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((n, i) => n === b[i])

export interface Condense {
  /** Receives the captured output a later failing state adds beyond what was already shown. */
  readonly print: (text: string) => void
}

export async function runStates(
  states: readonly TestState[],
  run: RunTasks,
  log: (line: string) => void,
  condense?: Condense,
): Promise<number> {
  const asResult = (r: number | null | RunResult): RunResult =>
    typeof r === "object" && r !== null ? r : { status: r, output: "" }
  if (states.length === 1)
    return asResult(await run(states[0]!.tasks, states[0]!.env, true)).status ?? 1
  let failed = false
  const seen: { label: string; failures: ReadonlyMap<string, readonly string[]> }[] = []
  for (const [i, state] of states.entries()) {
    const { status, output } = asResult(await run(state.tasks, state.env, !condense || i === 0))
    const ok = status === 0
    if (!ok) failed = true
    log(`test-states: ${state.label} — ${ok ? "pass" : "FAIL"}`)
    if (ok || !condense) continue
    const mine = failuresOf(output, state.tasks)
    if (i > 0 && mine.size === 0) {
      condense.print(`${output}\n`)
    } else if (i > 0) {
      const covering: string[] = []
      const novel = new Set(mine.keys())
      for (const earlier of seen) {
        const hits = [...novel].filter((t) => sameTests(earlier.failures.get(t), mine.get(t)!))
        if (hits.length > 0) covering.push(earlier.label)
        hits.forEach((t) => novel.delete(t))
      }
      if (novel.size === 0) {
        log(`test-states: ${state.label} — same failures as ${covering.join(", ")}`)
      } else if (seen.length === 0) {
        condense.print(`${output}\n`)
      } else {
        const own = stripAnsi(output)
          .split("\n")
          .filter((l) => novel.has(taskOf(l, state.tasks) ?? ""))
        condense.print(`${own.join("\n")}\n`)
      }
    }
    seen.push({ label: state.label, failures: mine })
  }
  return failed ? 1 : 0
}

export const turboArgv = (tasks: readonly string[], args: readonly string[]): string[] => [
  "run",
  ...tasks,
  ...args,
]

// args must be turbo options: a bare word would run as an extra task, and
// --dry-run/--graph exit 0 without running anything.
export const spawnTurbo = (
  tasks: readonly string[],
  env: Env,
  args: readonly string[] = [],
  live = true,
): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn("turbo", turboArgv(tasks, args), {
      stdio: ["inherit", "pipe", "pipe"],
      env: env as NodeJS.ProcessEnv,
    })
    // Always captured: a live state's failures are what later states are compared against.
    let output = ""
    const tee = (sink: NodeJS.WriteStream) => (chunk: Buffer) => {
      output += chunk.toString()
      if (live) sink.write(chunk)
    }
    child.stdout.on("data", tee(process.stdout))
    child.stderr.on("data", tee(process.stderr))
    child.on("error", (e) => {
      console.error(`test-states: cannot run turbo: ${e.message}`)
      resolve({ status: null, output })
    })
    child.on("close", (status) => resolve({ status, output }))
  })
