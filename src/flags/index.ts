// Flags are not recorded in history, so replay must not read the live value: flow code may
// branch on a flag only through its pinned `flag_<name>` setting. No lint rule enforces this.

export type FlagKind = "release" | "ops" | "experiment"

export interface FlagDeclaration {
  readonly name: string
  readonly owner: string
  /** ISO `YYYY-MM-DD`; never enforced at runtime. */
  readonly expiry: string
  readonly kind: FlagKind
  /** Unset or empty resolves on; `0`/`false` is still the kill switch. */
  readonly defaultOn?: boolean
}

export const FLAGS = [
  { name: "naive_pass", owner: "pmelab", expiry: "2027-01-15", kind: "release" },
] as const satisfies readonly FlagDeclaration[]

/** A misspelt name is a compile error. */
export type Flags<R extends readonly FlagDeclaration[] = typeof FLAGS> = {
  readonly [N in R[number]["name"]]: boolean
}

const BOOL: Record<string, boolean> = { "0": false, false: false, "1": true, true: true }

/** A `flag_<name>` setting's value as the pinned `"1"`/`"0"`, or undefined when garbled. */
export const flagSettingValue = (raw: string): "0" | "1" | undefined => {
  const key = raw.toLowerCase()
  return Object.hasOwn(BOOL, key) ? (BOOL[key] ? "1" : "0") : undefined
}

export const resolveFlags = <const R extends readonly FlagDeclaration[] = typeof FLAGS>(
  env: Readonly<Record<string, string | undefined>>,
  registry: R = FLAGS as unknown as R,
): Flags<R> => {
  const out: Record<string, boolean> = {}
  for (const { name, defaultOn } of registry) {
    const variable = `GTD_FLAG_${name.toUpperCase()}`
    const key = (env[variable] ?? "").toLowerCase()
    if (key === "") {
      out[name] = defaultOn ?? false
      continue
    }
    if (!Object.hasOwn(BOOL, key)) {
      throw new Error(`${variable} must be 1, 0, true or false`)
    }
    out[name] = BOOL[key]!
  }
  return out as Flags<R>
}

export const flagSettings = (flags: Readonly<Record<string, boolean>>): Record<string, string> =>
  Object.fromEntries(Object.entries(flags).map(([name, on]) => [`flag_${name}`, on ? "1" : "0"]))
