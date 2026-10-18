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
 * Failed task -> its sorted failing test names, as the repo reporter prints them. A task with
 * no names (typecheck, lint, build) maps to [] and is never "the same": its lines carry
 * per-state cache hashes, so only the names are a stable identity.
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
  const names = new Map(failed.map((t) => [t, new Set<string>()]))
  for (const line of lines) {
    const task = taskOf(line, tasks)
    const set = task && names.get(task)
    if (!set) continue
    const m = /^FAIL\s+(.*?)\s*$/.exec(line.slice(task.length + 2))
    if (m) set.add(m[1]!)
  }
  return new Map([...names].map(([t, s]) => [t, [...s].sort()]))
}

const taskOf = (line: string, tasks: readonly string[]): string | undefined =>
  tasks.find((t) => line.startsWith(`${t}: `))

const sameTests = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && b.length > 0 && a.length === b.length && a.every((n, i) => n === b[i])

interface Seen {
  readonly label: string
  readonly failures: ReadonlyMap<string, readonly string[]>
}

function condenseFailure({
  state,
  output,
  mine,
  seen,
  print,
  log,
}: {
  state: TestState
  output: string
  mine: ReadonlyMap<string, readonly string[]>
  seen: readonly Seen[]
  print: (text: string) => void
  log: (line: string) => void
}): void {
  if (mine.size === 0) return print(`${output}\n`)
  const covering: string[] = []
  const novel = new Set(mine.keys())
  for (const earlier of seen) {
    const hits = [...novel].filter((t) => sameTests(earlier.failures.get(t), mine.get(t)!))
    if (hits.length > 0) covering.push(earlier.label)
    hits.forEach((t) => novel.delete(t))
  }
  if (novel.size === 0)
    return log(`test-states: ${state.label} — failures already seen in ${covering.join(", ")}`)
  if (seen.length === 0) return print(`${output}\n`)
  const own = stripAnsi(output)
    .split("\n")
    .filter((l) => novel.has(taskOf(l, state.tasks) ?? ""))
  // A novel task with no prefixed lines (e.g. --log-prefix=none) still has to be shown.
  print(`${own.length > 0 ? own.join("\n") : output}\n`)
}

export async function runStates(
  states: readonly TestState[],
  run: RunTasks,
  log: (line: string) => void,
  print: (text: string) => void,
): Promise<number> {
  if (states.length === 1) return (await run(states[0]!.tasks, states[0]!.env, true)).status ?? 1
  let failed = false
  const seen: Seen[] = []
  for (const [i, state] of states.entries()) {
    const { status, output } = await run(state.tasks, state.env, i === 0)
    const ok = status === 0
    if (!ok) failed = true
    log(`test-states: ${state.label} — ${ok ? "pass" : "FAIL"}`)
    if (ok) continue
    const mine = failuresOf(output, state.tasks)
    if (i > 0) condenseFailure({ state, output, mine, seen, print, log })
    seen.push({ label: state.label, failures: mine })
  }
  return failed ? 1 : 0
}

// --continue=dependencies-successful: without --continue turbo kills the other tasks at the
// first failure, and `Failed:` would list just that one. A bare --continue means `always`,
// which would run the e2e tasks against a stale dist/ bundle after a failed `build`.
// --color: stdout is a pipe, so turbo would otherwise drop colour from a streamed run;
// failuresOf strips it anyway.
export const turboArgv = (
  tasks: readonly string[],
  args: readonly string[],
  color = false,
): string[] => [
  "run",
  ...tasks,
  "--continue=dependencies-successful",
  ...(color ? ["--color"] : []),
  ...args,
]

export interface Io {
  readonly out: (text: string) => void
  readonly err: (text: string) => void
  readonly tty: boolean
}

// Only whole lines reach `append`, so a stderr line never lands inside a split stdout line.
const wholeLines = (append: (text: string) => void) => {
  let rest = ""
  return {
    push(chunk: string) {
      rest += chunk
      const end = rest.lastIndexOf("\n") + 1
      if (end === 0) return
      append(rest.slice(0, end))
      rest = rest.slice(end)
    },
    flush() {
      if (rest) append(rest)
      rest = ""
    },
  }
}

// args must be turbo options: a bare word would run as an extra task, and
// --dry-run/--graph exit 0 without running anything.
export const spawnTurbo = (
  tasks: readonly string[],
  env: Env,
  args: readonly string[],
  live: boolean,
  io: Io,
): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn("turbo", turboArgv(tasks, args, live && io.tty), {
      stdio: ["inherit", "pipe", "pipe"],
      env: env as NodeJS.ProcessEnv,
    })
    // Always captured: a live state's failures are what later states are compared against.
    let output = ""
    const append = (text: string) => {
      output += text
    }
    const out = wholeLines(append)
    const err = wholeLines(append)
    // Decode whole characters: a chunk boundary inside `×`/`❯` would corrupt a FAIL name.
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      out.push(chunk)
      if (live) io.out(chunk)
    })
    child.stderr.on("data", (chunk: string) => {
      err.push(chunk)
      if (live) io.err(chunk)
    })
    child.on("error", (e) => {
      io.err(`test-states: cannot run turbo: ${e.message}\n`)
      resolve({ status: null, output })
    })
    child.on("close", (status) => {
      out.flush()
      err.flush()
      resolve({ status, output })
    })
  })
