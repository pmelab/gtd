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

/** One turbo run: exit status and captured stdout (stderr stays inherited). */
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
      .replace(/\b[0-9a-f]{12,}\b/gi, "<hex>")
      .replace(/\d+(\.\d+)?\s?(ms|s|m|h)\b/g, "<dur>")
    byTask.set(task, [...(byTask.get(task) ?? []), norm])
  }
  return [...byTask.keys()]
    .sort()
    .map((t) => byTask.get(t)!.join("\n"))
    .join("\n")
}

export function runStates(
  states: readonly TestState[],
  run: RunTasks,
  log: (line: string) => void,
): number {
  const print = (stdout: string) => {
    if (stdout.length > 0) log(stdout.replace(/\n$/, ""))
  }
  if (states.length === 1) {
    const { code, stdout } = run(states[0]!.tasks, states[0]!.env)
    print(stdout)
    return code ?? 1
  }
  let failed = false
  const seen = new Map<string, string>()
  for (const state of states) {
    const { code, stdout } = run(state.tasks, state.env)
    if (code === 0) {
      log(`test-states: ${state.label} — pass`)
      continue
    }
    failed = true
    const sig = failureSignature(stdout, state.tasks)
    const earlier = sig === "" ? undefined : seen.get(sig)
    if (earlier !== undefined) {
      log(`test-states: ${state.label} — FAIL (same failure as ${earlier})`)
      continue
    }
    if (sig !== "") seen.set(sig, state.label)
    print(stdout)
    log(`test-states: ${state.label} — FAIL`)
  }
  return failed ? 1 : 0
}

export const turboArgv = (tasks: readonly string[], args: readonly string[]): string[] => [
  "run",
  ...tasks,
  ...args,
  // turbo 2.10.9 rejects --output-logs twice, so a user's value replaces the default.
  ...(args.some((a) => a === "--output-logs" || a.startsWith("--output-logs="))
    ? []
    : ["--output-logs=errors-only"]),
]

// args must be turbo options: a bare word would run as an extra task, and
// --dry-run/--graph exit 0 without running anything.
export const spawnTurbo = (
  tasks: readonly string[],
  env: Env,
  args: readonly string[] = [],
): TurboRun => {
  const result = spawnSync("turbo", turboArgv(tasks, args), {
    stdio: ["inherit", "pipe", "inherit"],
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    // The 1 MiB default kills turbo on a long failure log (ENOBUFS), which would read as FAIL.
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error) console.error(`test-states: cannot run turbo: ${result.error.message}`)
  return { code: result.status, stdout: result.error ? "" : (result.stdout ?? "") }
}
