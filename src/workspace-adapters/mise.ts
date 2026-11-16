import { execFile } from "node:child_process"
import {
  AdapterError,
  type Action,
  type ActionField,
  type ActionsAdapter,
  type ActionStatus,
  type ActionValues,
} from "../workspace/index.js"

export interface MiseOptions {
  /** The `mise` executable. */
  readonly bin?: string
}

interface Outcome {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface Choices {
  readonly choices?: { readonly choices?: readonly string[] }
}

interface UsageArg extends Choices {
  readonly name: string
  readonly help_first_line?: string
  readonly required?: boolean
  readonly hide?: boolean
}

interface UsageFlag {
  readonly name: string
  readonly help_first_line?: string
  readonly long?: readonly string[]
  readonly short?: readonly string[]
  readonly required?: boolean
  readonly hide?: boolean
  /** Absent for a flag that takes no value. */
  readonly arg?: Choices
}

interface TaskInfo {
  readonly name: string
  readonly description?: string
  readonly usage_spec?: {
    readonly cmd?: { readonly args?: readonly UsageArg[]; readonly flags?: readonly UsageFlag[] }
  }
}

// gtd's naming rule for tasks that are actions; mise has no field for it.
const PREFIXES: Readonly<Record<string, ActionStatus>> = {
  "start:": "idle",
  "gate:": "needsYou",
  "error:": "error",
  "any:": "any",
}

const statusOf = (task: string): ActionStatus | undefined =>
  Object.entries(PREFIXES).find(([prefix]) => task.startsWith(prefix))?.[1]

const choicesOf = (spec: Choices | undefined): readonly string[] | undefined => {
  const choices = spec?.choices?.choices
  return choices === undefined || choices.length === 0 ? undefined : choices
}

const field = (
  name: string,
  type: ActionField["type"],
  required: boolean,
  help: string | undefined,
  choices?: readonly string[],
): ActionField => ({
  name,
  type: choices === undefined ? type : "select",
  required,
  ...(choices === undefined ? {} : { choices }),
  ...(help ? { help } : {}),
})

const argField = (arg: UsageArg): ActionField =>
  field(arg.name, "text", arg.required === true, arg.help_first_line, choicesOf(arg))

const flagField = (flag: UsageFlag): ActionField =>
  field(
    flag.name,
    flag.arg === undefined ? "flag" : "text",
    flag.required === true,
    flag.help_first_line,
    flag.arg === undefined ? undefined : choicesOf(flag.arg),
  )

const visible = <A extends { readonly hide?: boolean }>(items: readonly A[] | undefined): A[] =>
  (items ?? []).filter((item) => item.hide !== true)

/**
 * usage reads a flag's value that spells one of the task's flags as that
 * flag, even after `=`, and drops a `--`.
 */
const misreadAsFlag = (flags: readonly UsageFlag[]): ((value: string) => boolean) => {
  const spellings = new Set(
    flags.flatMap((f) => [
      ...(f.long ?? []).map((l) => `--${l}`),
      ...(f.short ?? []).map((s) => `-${s}`),
    ]),
  )
  return (value) =>
    value === "--" ||
    spellings.has(value.split("=")[0]!) ||
    (/^-[^-]/.test(value) && spellings.has(value.slice(0, 2)))
}

const flagArgs = (
  flags: readonly UsageFlag[],
  values: ActionValues,
  refuse: (message: string) => never,
): string[] => {
  const misread = misreadAsFlag(flags)
  return visible(flags).flatMap((flag) => {
    const value = values[flag.name]
    const long = flag.long?.[0] ?? flag.name
    if (value === undefined || value === "") return []
    if (value === true) return [`--${long}`]
    if (misread(value)) refuse(`${flag.name}: mise would read ${JSON.stringify(value)} as a flag`)
    return [`--${long}=${value}`]
  })
}

const positionalArgs = (
  args: readonly UsageArg[],
  values: ActionValues,
  refuse: (message: string) => never,
): string[] => {
  const given: string[] = []
  let skipped: string | undefined
  for (const arg of visible(args)) {
    const value = values[arg.name]
    if (typeof value !== "string") {
      skipped ??= arg.name
      continue
    }
    // Arguments are positional: one left empty shifts every later one.
    if (skipped !== undefined) refuse(`${arg.name} needs ${skipped} filled in`)
    // usage drops a `--` it finds after the separator.
    if (value === "--") refuse(`${arg.name}: mise cannot pass "--" as a value`)
    given.push(value)
  }
  return given
}

/**
 * The actions adapter over mise tasks: `start:*`, `gate:*`, `error:*` and
 * `any:*` are the actions for idle, needs-you, error and any worktree status.
 * A task's usage spec gives the fields; its description is the label.
 */
export const mise = (options: MiseOptions = {}): ActionsAdapter => {
  const bin = options.bin ?? "mise"
  const call = (worktree: string, args: readonly string[]): Promise<Outcome> =>
    new Promise((resolve) => {
      execFile(
        bin,
        args,
        { cwd: worktree, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1
          resolve({ code, stdout, stderr: stderr || (error?.message ?? "") })
        },
      )
    })
  const fail = (op: string, message: string, detail?: unknown): never => {
    throw new AdapterError({ adapter: "actions", op, message: `mise: ${message}`, detail })
  }
  const json = async <A>(op: string, worktree: string, args: readonly string[]): Promise<A> => {
    const outcome = await call(worktree, args)
    if (outcome.code !== 0) {
      fail(op, outcome.stderr.trim().split("\n")[0] || `exit ${outcome.code}`, {
        exitCode: outcome.code,
        stderr: outcome.stderr,
      })
    }
    try {
      return JSON.parse(outcome.stdout) as A
    } catch {
      return fail(op, `not JSON: ${outcome.stdout}`)
    }
  }
  const info = (op: string, worktree: string, task: string): Promise<TaskInfo> =>
    json<TaskInfo>(op, worktree, ["tasks", "info", task, "--json"])

  return {
    list: async (worktree) => {
      const tasks = await json<readonly { name: string; hide?: boolean }[]>("list", worktree, [
        "tasks",
        "ls",
        "--json",
      ])
      const actions = tasks.filter((t) => t.hide !== true && statusOf(t.name) !== undefined)
      return Promise.all(
        actions.map(async ({ name }): Promise<Action> => {
          const task = await info("list", worktree, name)
          const cmd = task.usage_spec?.cmd
          return {
            id: name,
            label: task.description || name,
            status: statusOf(name)!,
            fields: [...visible(cmd?.args).map(argField), ...visible(cmd?.flags).map(flagField)],
          }
        }),
      )
    },
    argv: async (worktree, id, values) => {
      if (statusOf(id) === undefined) fail("argv", `${id} is not an action`)
      const cmd = (await info("argv", worktree, id)).usage_spec?.cmd
      const refuse = (message: string): never => fail("argv", message)
      // The first `--` ends mise's own options; the second ends the task's flags.
      return [
        bin,
        "run",
        id,
        "--",
        ...flagArgs(cmd?.flags ?? [], values, refuse),
        "--",
        ...positionalArgs(cmd?.args ?? [], values, refuse),
      ]
    },
  }
}
