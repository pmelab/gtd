import { spawnSync } from "node:child_process"
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

export interface VpRun {
  readonly code: number | null
  readonly stdout: string
}

export type RunTasks = (tasks: readonly string[], env: Env) => VpRun

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
  const states: TestState[] = [{ label: "defaults", tasks: TASKS, env: pinned() }]
  for (const { name, defaultOn } of releases) {
    states.push({
      label: `${name} ${defaultOn ? "off" : "on"}`,
      tasks: VITEST_TASKS,
      env: pinned(name),
    })
  }
  return states
}

// Parallel tasks interleave nondeterministically, so lines group per task. Normalisation errs
// toward "distinct": a random temp path keeps two states apart.
export function failureSignature(stdout: string, tasks: readonly string[]): string {
  const byTask = new Map<string, string[]>()
  for (const raw of stdout.split("\n")) {
    const line = raw
      // oxlint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
      .replace(/\r$/, "")
    // `vp run --log labeled` prefixes `[<package>#<task>] `.
    const m = /^\[(?:[^\]#]*#)?([^\]]+)\] ?(.*)$/.exec(line)
    if (m === null || !tasks.includes(m[1]!)) continue
    const [, task, body] = m as unknown as [string, string, string]
    // A block's presence is evidence the task failed, even when all its lines are boilerplate.
    if (!byTask.has(task)) byTask.set(task, [])
    // vp's own `$ <command> [cache status]` echo, once per `&&` part.
    if (/^\$ /.test(body) || body.trim() === "") continue
    const norm = `${task}: ${body}`
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<ts>")
      .replace(/\d{1,2}:\d{2}:\d{2}/g, "<time>")
      .replace(/\b[0-9a-f]{16}\b/gi, "<hex>")
      .replace(/\d+(\.\d+)?\s?(ms|s|m|h)\b/g, "<dur>")
    byTask.get(task)!.push(norm)
  }
  if ([...byTask.values()].every((lines) => lines.length === 0)) return ""
  return [...byTask.keys()]
    .sort()
    .map((t) => [`${t}:`, ...byTask.get(t)!].join("\n"))
    .join("\n")
}

const printOut = (log: (line: string) => void, stdout: string) => {
  if (stdout.length > 0) log(stdout.replace(/\n$/, ""))
}

function reportFailure(
  state: TestState,
  stdout: string,
  seen: Map<string, string>,
  log: (line: string) => void,
  { full, collapse }: Required<RunOptions>,
): void {
  const sig = collapse && !full ? failureSignature(stdout, state.tasks) : ""
  const earlier = sig === "" ? undefined : seen.get(sig)
  if (earlier !== undefined) {
    log(`test-states: ${state.label} — FAIL (same failure as ${earlier})`)
    return
  }
  if (sig !== "") seen.set(sig, state.label)
  printOut(log, stdout)
  log(`test-states: ${state.label} — FAIL`)
}

export interface RunOptions {
  /** Print passing states' logs too; never collapses. */
  readonly full?: boolean
  readonly collapse?: boolean
}

export function runStates(
  states: readonly TestState[],
  run: RunTasks,
  log: (line: string) => void,
  options: RunOptions = {},
): number {
  const opts = { full: options.full ?? false, collapse: options.collapse ?? true }
  const { full } = opts
  if (states.length === 1) {
    const { code, stdout } = run(states[0]!.tasks, states[0]!.env)
    printOut(log, stdout)
    return code ?? 1
  }
  let failed = false
  const seen = new Map<string, string>()
  for (const state of states) {
    const { code, stdout } = run(state.tasks, state.env)
    if (code === 0) {
      if (full) printOut(log, stdout)
      log(`test-states: ${state.label} — pass`)
      continue
    }
    failed = true
    reportFailure(state, stdout, seen, log, opts)
  }
  return failed ? 1 : 0
}

/** Value of `--flag=x` or `--flag x`; "" when the flag ends args, undefined when absent. Stops at `--`. */
export function flagValue(args: readonly string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === "--") return undefined
    if (a === flag) return args[i + 1] ?? ""
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1)
  }
  return undefined
}

// `vp run` takes one task: each task set the runner plans is an aggregate in vite.config.ts.
export const gateFor = (tasks: readonly string[]): string =>
  tasks === TASKS ? "gate" : tasks === VITEST_TASKS ? "gate:tests" : tasks.join(",")

// vp options must precede the task name; anything after it reaches the task's command.
export const vpArgv = (tasks: readonly string[], args: readonly string[]): string[] => [
  "run",
  ...(flagValue(args, "--log") === undefined ? ["--log", "labeled"] : []),
  ...args.filter((a) => a !== "--full"),
  gateFor(tasks),
]

export const runOptions = (args: readonly string[]): Required<RunOptions> => ({
  full: args.includes("--full"),
  collapse: !args.includes("--full") && (flagValue(args, "--log") ?? "labeled") === "labeled",
})

export const spawnVp = (
  tasks: readonly string[],
  env: Env,
  args: readonly string[] = [],
): VpRun => {
  const result = spawnSync("vp", vpArgv(tasks, args), {
    // stdout is buffered, so an interrupted run loses the current state's log; stderr stays live.
    stdio: ["inherit", "pipe", "inherit"],
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    // The 1 MiB default kills vp on a long failure log (ENOBUFS), which would read as FAIL.
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error) console.error(`test-states: cannot run vp: ${result.error.message}`)
  return { code: result.status, stdout: result.stdout ?? "" }
}
