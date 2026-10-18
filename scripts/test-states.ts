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

export interface TurboRun {
  readonly code: number | null
  readonly stdout: string
}

export type RunTasks = (tasks: readonly string[], env: Env) => TurboRun

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
    const task = tasks.find((t) => line.startsWith(`${t}: `))
    if (task === undefined) continue
    const norm = line
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "<ts>")
      .replace(/\d{1,2}:\d{2}:\d{2}/g, "<time>")
      .replace(/\b[0-9a-f]{16}\b/gi, "<hex>")
      .replace(/\d+(\.\d+)?\s?(ms|s|m|h)\b/g, "<dur>")
    const lines = byTask.get(task) ?? []
    lines.push(norm)
    byTask.set(task, lines)
  }
  return [...byTask.keys()]
    .sort()
    .map((t) => byTask.get(t)!.join("\n"))
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

export const turboArgv = (tasks: readonly string[], args: readonly string[]): string[] => [
  "run",
  ...tasks,
  // turbo 2.10.9 rejects a flag twice, so a user's value replaces the default.
  ...(flagValue(args, "--output-logs") === undefined ? ["--output-logs=errors-only"] : []),
  // Turbo's default `auto` drops the "<task>: " prefix in GitHub Actions, which failureSignature needs.
  ...(flagValue(args, "--log-prefix") === undefined ? ["--log-prefix=task"] : []),
  // Defaults precede args so a `--` in args cannot hand them to the tasks.
  ...args,
]

// hash-only and none print no failure log, so signatures would merge distinct failures.
const LOG_VALUES_THAT_COLLAPSE = [undefined, "errors-only", "new-only"]

export const runOptions = (args: readonly string[]): Required<RunOptions> => {
  const outputLogs = flagValue(args, "--output-logs")
  return {
    full: outputLogs === "full",
    collapse:
      (flagValue(args, "--log-prefix") ?? "task") === "task" &&
      LOG_VALUES_THAT_COLLAPSE.includes(outputLogs),
  }
}

// args must be turbo options: a bare word would run as an extra task, and
// --dry-run/--graph exit 0 without running anything.
export const spawnTurbo = (
  tasks: readonly string[],
  env: Env,
  args: readonly string[] = [],
): TurboRun => {
  const result = spawnSync("turbo", turboArgv(tasks, args), {
    // stdout is buffered, so an interrupted run loses the current state's log; stderr stays live
    // so turbo's error banner is never buffered.
    stdio: ["inherit", "pipe", "inherit"],
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    // The 1 MiB default kills turbo on a long failure log (ENOBUFS), which would read as FAIL.
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error) console.error(`test-states: cannot run turbo: ${result.error.message}`)
  return { code: result.status, stdout: result.stdout ?? "" }
}
