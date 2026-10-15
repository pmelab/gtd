// A flag may change how a step runs, never which step comes next: flags are not recorded in
// history, so replay must not read them. No lint rule enforces this.

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

export const FLAGS = [] as const satisfies readonly FlagDeclaration[]

/** A misspelt name is a compile error. */
export type Flags<R extends readonly FlagDeclaration[] = typeof FLAGS> = {
  readonly [N in R[number]["name"]]: boolean
}

const BOOL: Record<string, boolean> = { "0": false, false: false, "1": true, true: true }

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
