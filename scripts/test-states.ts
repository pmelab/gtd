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

export type RunTasks = (
  tasks: readonly string[],
  env: Env,
  live: boolean,
) => RunResult | Promise<RunResult>

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

/**
 * Failed task -> its failing vitest test names, or its own output lines when it names none
 * (typecheck, lint, an unhandled error), so an empty list never makes two failures look equal.
 */
export function failuresOf(
  output: string,
  tasks: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const lines = stripAnsi(output).split("\n")
  const failed = lines.flatMap((l) => {
    const m = /^Failed:\s+(.*)$/.exec(l)
    return m ? m[1]!.split(",").map((t) => t.trim().replace(/^.*#/, "")) : []
  })
  const own = new Map(failed.map((t) => [t, { names: [] as string[], lines: [] as string[] }]))
  for (const line of lines) {
    const task = taskOf(line, tasks)
    const entry = task && own.get(task)
    if (!entry) continue
    const text = line.slice(task.length + 2)
    entry.lines.push(text)
    const m = /^\s*FAIL\s+(.*?)\s*$/.exec(text)
    if (m) entry.names.push(m[1]!)
  }
  return new Map(
    [...own].map(([t, e]) => [t, e.names.length > 0 ? [...new Set(e.names)].sort() : e.lines]),
  )
}

const taskOf = (line: string, tasks: readonly string[]): string | undefined =>
  tasks.find((t) => line.startsWith(`${t}: `))

const sameTests = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((n, i) => n === b[i])

export interface Condense {
  readonly print: (text: string) => void
}

interface Seen {
  readonly label: string
  readonly failures: ReadonlyMap<string, readonly string[]>
}

function condenseFailure({
  state,
  output,
  mine,
  seen,
  condense,
  log,
}: {
  state: TestState
  output: string
  mine: ReadonlyMap<string, readonly string[]>
  seen: readonly Seen[]
  condense: Condense
  log: (line: string) => void
}): void {
  if (mine.size === 0) return condense.print(`${output}\n`)
  const covering: string[] = []
  const novel = new Set(mine.keys())
  for (const earlier of seen) {
    const hits = [...novel].filter((t) => sameTests(earlier.failures.get(t), mine.get(t)!))
    if (hits.length > 0) covering.push(earlier.label)
    hits.forEach((t) => novel.delete(t))
  }
  if (novel.size === 0)
    return log(`test-states: ${state.label} — same failures as ${covering.join(", ")}`)
  if (seen.length === 0) return condense.print(`${output}\n`)
  const own = stripAnsi(output)
    .split("\n")
    .filter((l) => novel.has(taskOf(l, state.tasks) ?? ""))
  condense.print(`${own.join("\n")}\n`)
}

export async function runStates(
  states: readonly TestState[],
  run: RunTasks,
  log: (line: string) => void,
  condense?: Condense,
): Promise<number> {
  if (states.length === 1) return (await run(states[0]!.tasks, states[0]!.env, true)).status ?? 1
  let failed = false
  const seen: Seen[] = []
  for (const [i, state] of states.entries()) {
    const { status, output } = await run(state.tasks, state.env, !condense || i === 0)
    const ok = status === 0
    if (!ok) failed = true
    log(`test-states: ${state.label} — ${ok ? "pass" : "FAIL"}`)
    if (ok || !condense) continue
    const mine = failuresOf(output, state.tasks)
    if (i > 0) condenseFailure({ state, output, mine, seen, condense, log })
    seen.push({ label: state.label, failures: mine })
  }
  return failed ? 1 : 0
}

// --continue: without it turbo kills the other tasks at the first failure, and
// `Failed:` would list just that one. --color: stdout is a pipe, so turbo would
// otherwise drop colour from a streamed run; failuresOf strips it anyway.
export const turboArgv = (
  tasks: readonly string[],
  args: readonly string[],
  color = false,
): string[] => ["run", ...tasks, "--continue", ...(color ? ["--color"] : []), ...args]

// args must be turbo options: a bare word would run as an extra task, and
// --dry-run/--graph exit 0 without running anything.
export const spawnTurbo = (
  tasks: readonly string[],
  env: Env,
  args: readonly string[] = [],
  live = true,
): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn("turbo", turboArgv(tasks, args, live && process.stdout.isTTY === true), {
      stdio: ["inherit", "pipe", "pipe"],
      env: env as NodeJS.ProcessEnv,
    })
    // Always captured: a live state's failures are what later states are compared against.
    let output = ""
    // Decode whole characters: a chunk boundary inside `×`/`❯` would corrupt a FAIL name.
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    const tee = (sink: NodeJS.WriteStream) => (chunk: string) => {
      output += chunk
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
