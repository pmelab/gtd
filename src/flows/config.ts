import type { ScopeAccess } from "./runtime.js"

/** One steering-file mode's shell commands; each reads the file from `$GTD_FILE`. */
export interface ModeCommands {
  readonly format?: string
  readonly validate?: string
}

/** `gtd ui` settings; its `--host`/`--port` flags outrank `host`/`port`. */
export interface UiSettings {
  readonly port?: number
  readonly host?: string
  readonly cert?: string
  readonly key?: string
  readonly format?: string
}

/** The repository settings a `gtd.config.ts` exports as `config`. */
export interface GtdConfig {
  readonly modes?: Readonly<Record<string, ModeCommands>>
  readonly ui?: UiSettings
  readonly skills?: Readonly<Record<string, readonly string[]>>
  readonly access?: Readonly<Record<string, ScopeAccess>>
}

export interface ConfigProblem {
  readonly path: readonly string[]
  readonly message: string
}

const CONFIG_KEYS = ["modes", "ui", "skills", "access"] as const
const MODE_KEYS = ["format", "validate"] as const
const UI_KEYS = ["port", "host", "cert", "key", "format"] as const

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
    .map((key) => ({ path: [...path, key], message: "is not a known key" }))

const recordOf = (
  value: unknown,
  path: readonly string[],
  shape: string,
  entry: (value: unknown, path: readonly string[]) => ConfigProblem[],
): ConfigProblem[] =>
  isRecord(value)
    ? Object.entries(value).flatMap(([key, v]) => entry(v, [...path, key]))
    : [{ path, message: `must be an object of ${shape}` }]

const modeProblems = (value: unknown, path: readonly string[]): ConfigProblem[] => {
  if (path.at(-1) === "") return [{ path, message: "is a mode without a name" }]
  // An empty mode still registers its name: a step may use it, unformatted and unvalidated.
  if (!isRecord(value))
    return [{ path, message: 'must be an object with "format" and/or "validate"' }]
  return [
    ...unknownKeys(value, MODE_KEYS, path),
    ...MODE_KEYS.flatMap((key) => {
      const command = value[key]
      return command === undefined || (typeof command === "string" && command.trim() !== "")
        ? []
        : [{ path: [...path, key], message: "must be a non-empty shell command" }]
    }),
  ]
}

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
    ...(value.modes === undefined ? [] : recordOf(value.modes, ["modes"], "modes", modeProblems)),
    ...(value.ui === undefined ? [] : uiProblems(value.ui, ["ui"])),
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
