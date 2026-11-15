import type { WorktreesAdapter } from "./adapters.js"

/** A duration such as `"30s"`, `"5m"` or `"1h"`. */
export type Duration = `${number}${"ms" | "s" | "m" | "h"}`

export interface NotifySettings {
  readonly needsYou?: boolean
  readonly error?: boolean
  readonly proposed?: boolean
  readonly feedFailing?: boolean
  readonly configError?: boolean
  readonly mainStale?: boolean
}

export interface ProjectSettings {
  /** Shown on the dashboard instead of the project id. */
  readonly name?: string
  /** This project's driver command, instead of the workspace's. */
  readonly driver?: readonly string[]
  readonly wip?: number
  readonly notify?: NotifySettings
  /** `false` keeps auto-clean off for this project. */
  readonly clean?: false
}

export interface WorkspaceUiSettings {
  readonly port?: number
  readonly host?: string
  readonly cert?: string
  readonly key?: string
  /** The tailnet logins allowed to use the dashboard; the node owner when absent. */
  readonly users?: readonly string[]
}

export interface WorkspaceAdapters {
  readonly worktrees?: WorktreesAdapter
  readonly terminal?: object
  readonly services?: object
  readonly actions?: object
  readonly notifications?: object
}

/** What `gtd.workspace.ts` exports as `workspace`. */
export interface WorkspaceSettings {
  /** The driver command, as an argv. */
  readonly driver?: readonly string[]
  readonly adapters?: WorkspaceAdapters
  readonly limits?: { readonly maxDrives?: number; readonly wip?: number }
  readonly pollEvery?: Duration
  /** Settings per project id. */
  readonly projects?: Readonly<Record<string, ProjectSettings>>
  readonly notify?: NotifySettings
  readonly clean?: { readonly every: Duration }
  readonly ui?: WorkspaceUiSettings
}

export interface WorkspaceProblem {
  readonly path: readonly string[]
  readonly message: string
}

type Check = (value: unknown, path: readonly string[]) => WorkspaceProblem[]

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const rule =
  (ok: (v: unknown) => boolean, message: string): Check =>
  (value, path) =>
    ok(value) ? [] : [{ path, message }]

const DURATION = /^\d+(ms|s|m|h)$/
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const

/** A `Duration` in milliseconds. */
export const durationMs = (duration: Duration): number => {
  const [, amount, unit] = /^(\d+)(ms|s|m|h)$/.exec(duration)!
  return Number(amount) * UNIT_MS[unit as keyof typeof UNIT_MS]
}

const isPositiveInt = (v: unknown): boolean => Number.isInteger(v) && (v as number) > 0
const isNonEmptyStrings = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((entry) => typeof entry === "string" && entry !== "")

const argv = rule(isNonEmptyStrings, "must be a non-empty array of strings (an argv)")
const positiveInt = rule(isPositiveInt, "must be a positive integer")
const duration = rule(
  (v) => typeof v === "string" && DURATION.test(v),
  'must be a duration like "30s", "5m" or "1h"',
)
const flag = rule((v) => typeof v === "boolean", "must be true or false")
const text = rule((v) => typeof v === "string", "must be a string")

/** An object whose every key is known; an absent key is fine. */
const object =
  (keys: Readonly<Record<string, Check>>, required: readonly string[] = []): Check =>
  (value, path) => {
    if (!isRecord(value)) return [{ path, message: "must be an object" }]
    return [
      ...Object.keys(value)
        .filter((key) => !Object.hasOwn(keys, key))
        .map((key) => ({ path: [...path, key], message: "is not a known key" })),
      ...required
        .filter((key) => value[key] === undefined)
        .map((key) => ({ path: [...path, key], message: "is required" })),
      ...Object.entries(keys).flatMap(([key, check]) =>
        value[key] === undefined ? [] : check(value[key], [...path, key]),
      ),
    ]
  }

const recordOf =
  (entry: Check): Check =>
  (value, path) =>
    isRecord(value)
      ? Object.entries(value).flatMap(([key, v]) => entry(v, [...path, key]))
      : [{ path, message: "must be an object" }]

/** An adapter is any object with the interface's methods; extra members are its own business. */
const adapter =
  (methods: readonly string[]): Check =>
  (value, path) => {
    if (!isRecord(value)) return [{ path, message: "must be an adapter object" }]
    return methods
      .filter((method) => typeof value[method] !== "function")
      .map((method) => ({ path: [...path, method], message: "must be a function" }))
  }

const notify = object(
  Object.fromEntries(
    ["needsYou", "error", "proposed", "feedFailing", "configError", "mainStale"].map((k) => [
      k,
      flag,
    ]),
  ),
)

const settings = object({
  driver: argv,
  adapters: object({
    worktrees: adapter(["projects", "list"]),
    terminal: adapter([]),
    services: adapter([]),
    actions: adapter([]),
    notifications: adapter([]),
  }),
  limits: object({ maxDrives: positiveInt, wip: positiveInt }),
  pollEvery: duration,
  projects: recordOf(
    object({
      name: text,
      driver: argv,
      wip: positiveInt,
      notify,
      clean: rule((v) => v === false, "must be false (auto-clean is on for every project)"),
    }),
  ),
  notify,
  clean: object({ every: duration }, ["every"]),
  ui: object({
    port: rule(Number.isInteger, "must be an integer"),
    host: text,
    cert: text,
    key: text,
    users: rule(isNonEmptyStrings, "must be a non-empty array of tailnet login names"),
  }),
})

/** Every way `value` is not `WorkspaceSettings`, at any depth. */
export const workspaceProblems = (value: unknown): readonly WorkspaceProblem[] =>
  settings(value, [])

export const formatWorkspaceProblem = ({ path, message }: WorkspaceProblem): string =>
  `${["workspace", ...path].join(".")}: ${message}`

/**
 * Type and check the `workspace` export. A literal argument gets
 * TypeScript's excess-property check at every depth, and it throws at runtime
 * too.
 */
export const defineWorkspace = (workspace: WorkspaceSettings): WorkspaceSettings => {
  const problems = workspaceProblems(workspace)
  if (problems.length > 0) throw new Error(problems.map(formatWorkspaceProblem).join("; "))
  return workspace
}
