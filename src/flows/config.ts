import type { ScopeAccess } from "./runtime.js"

/** `gtd ui` settings; its `--host`/`--port` flags outrank `host`/`port`. */
export interface UiSettings {
  readonly port?: number
  readonly host?: string
  readonly cert?: string
  readonly key?: string
}

/** The repository settings a `gtd.config.ts` exports as `config`. */
export interface GtdConfig {
  readonly ui?: UiSettings
  readonly skills?: Readonly<Record<string, readonly string[]>>
  readonly access?: Readonly<Record<string, ScopeAccess>>
  /** A remote name: every finished or abandoned process force-pushes its history ref there. */
  readonly historyRemote?: string
}

export interface ConfigProblem {
  readonly path: readonly string[]
  readonly message: string
}

const CONFIG_KEYS = ["ui", "skills", "access", "historyRemote"] as const
const UI_KEYS = ["port", "host", "cert", "key"] as const

/** Keys that once meant something, and what replaced them. */
const REMOVED: Readonly<Record<string, string>> = {
  modes: "was removed: every steering file is a widget document gtd checks itself",
  "ui.format": "was removed: gtd writes every steering file in its own canonical form",
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isStringArray = (v: unknown): boolean =>
  Array.isArray(v) && v.every((entry) => typeof entry === "string")

const unknownKeys = (
  value: Record<string, unknown>,
  known: readonly string[],
  path: readonly string[],
): ConfigProblem[] =>
  Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => ({
      path: [...path, key],
      message: REMOVED[[...path, key].join(".")] ?? "is not a known key",
    }))

const recordOf = (
  value: unknown,
  path: readonly string[],
  shape: string,
  entry: (value: unknown, path: readonly string[]) => ConfigProblem[],
): ConfigProblem[] =>
  isRecord(value)
    ? Object.entries(value).flatMap(([key, v]) => entry(v, [...path, key]))
    : [{ path, message: `must be an object of ${shape}` }]

const uiProblems = (value: unknown, path: readonly string[]): ConfigProblem[] => {
  if (!isRecord(value)) return [{ path, message: "must be an object" }]
  return [
    ...unknownKeys(value, UI_KEYS, path),
    ...UI_KEYS.flatMap((key) => {
      const v = value[key]
      if (v === undefined) return []
      const ok = key === "port" ? Number.isInteger(v) : typeof v === "string"
      return ok
        ? []
        : [
            {
              path: [...path, key],
              message: key === "port" ? "must be an integer" : "must be a string",
            },
          ]
    }),
  ]
}

const accessProblems = (value: unknown, path: readonly string[]): ConfigProblem[] => {
  if (!isRecord(value))
    return [{ path, message: "must be an object of { read?, write? } glob arrays" }]
  return [
    ...unknownKeys(value, ["read", "write"], path),
    ...(["read", "write"] as const).flatMap((side) =>
      value[side] === undefined || isStringArray(value[side])
        ? []
        : [{ path: [...path, side], message: "must be an array of glob strings" }],
    ),
  ]
}

/** Every way `value` is not a `GtdConfig`; an unknown key is one, so a removed key fails loudly. */
export const configProblems = (value: unknown): readonly ConfigProblem[] => {
  if (!isRecord(value)) return [{ path: [], message: "must be an object" }]
  return [
    ...unknownKeys(value, CONFIG_KEYS, []),
    ...(value.ui === undefined ? [] : uiProblems(value.ui, ["ui"])),
    ...(value.historyRemote === undefined ||
    (typeof value.historyRemote === "string" && value.historyRemote.trim() !== "")
      ? []
      : [{ path: ["historyRemote"], message: "must be a non-empty remote name" }]),
    ...(value.skills === undefined
      ? []
      : recordOf(value.skills, ["skills"], "skill-name arrays", (v, path) =>
          isStringArray(v) ? [] : [{ path, message: "must be an array of skill names" }],
        )),
    ...(value.access === undefined
      ? []
      : recordOf(value.access, ["access"], "scope access", accessProblems)),
  ]
}

// The loader's diagnostic format, so a problem reads the same whether
// `defineConfig` throws it or the loader finds it in a plain object.
const formatConfigProblem = ({ path, message }: ConfigProblem): string =>
  `${["config", ...path].join(".")}: ${message}`

/**
 * Type and check the `config` export. Not generic on purpose: a literal argument
 * then gets TypeScript's excess-property check at every depth, so an unknown key
 * is a type error — and it throws at runtime too.
 */
export const defineConfig = (config: GtdConfig): GtdConfig => {
  const problems = configProblems(config)
  if (problems.length > 0) throw new Error(problems.map(formatConfigProblem).join("; "))
  return config
}
