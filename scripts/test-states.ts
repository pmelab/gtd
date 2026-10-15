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

export type RunTasks = (tasks: readonly string[], env: Env) => number | null

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

export function runStates(
  states: readonly TestState[],
  run: RunTasks,
  log: (line: string) => void,
): number {
  if (states.length === 1) return run(states[0]!.tasks, states[0]!.env) ?? 1
  let failed = false
  for (const state of states) {
    const ok = run(state.tasks, state.env) === 0
    if (!ok) failed = true
    log(`test-states: ${state.label} — ${ok ? "pass" : "FAIL"}`)
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
): number | null => {
  const result = spawnSync("turbo", turboArgv(tasks, args), {
    stdio: "inherit",
    env: env as NodeJS.ProcessEnv,
  })
  if (result.error) console.error(`test-states: cannot run turbo: ${result.error.message}`)
  return result.status
}
