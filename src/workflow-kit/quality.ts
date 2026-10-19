import { read } from "../flows/index.js"

export interface LensEntry {
  readonly lens: string
  /** Blank when the entry carries none. */
  readonly model: string
}

// Split at the first `=`: skill names may hold `:` (`plugin:skill`), never `=`.
export const lensOf = (entry: string): LensEntry => {
  const at = entry.indexOf("=")
  return at < 0
    ? { lens: entry.trim(), model: "" }
    : { lens: entry.slice(0, at).trim(), model: entry.slice(at + 1).trim() }
}

/** Split a comma-separated lens list into whole entries, `<lens>` or `<lens>=<model>`: trimmed, blanks dropped. */
export const lensEntriesOf = (value: string): readonly string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => lensOf(entry).lens.length > 0)

/** The same list's lens names, model hints cut off. */
export const lensesOf = (value: string): readonly string[] =>
  lensEntriesOf(value).map((entry) => lensOf(entry).lens)

/** One `<scope>.<lens>` entry per lens — the per-lens part of a skills or access export. */
export const lensScopes = <T>(
  scope: string,
  lenses: readonly string[],
  entry: (lens: string) => T,
): Record<string, T> => Object.fromEntries(lenses.map((lens) => [`${scope}.${lens}`, entry(lens)]))

/** One `review` turn per lens, each appending its findings to `findings`; resolves `"findings"` when that file has any. */
export const qualityLap = async (
  lenses: readonly string[],
  review: (lens: string) => Promise<void>,
  findings: string,
): Promise<"clean" | "findings"> => {
  for (const lens of lenses) await review(lens)
  return (read(findings) ?? "").length > 0 ? "findings" : "clean"
}

export interface FindingsFix {
  /** One fix turn; it removes `findings` once every finding is resolved. */
  readonly fix: () => Promise<void>
  readonly findings: string
  readonly cap: number
  /** Runs once `cap` turns left findings. */
  readonly escalate: () => Promise<void>
}

/** Resolves `true` once `findings` is gone, `false` when `cap` turns escalated instead. */
export const fixFindings = async (f: FindingsFix): Promise<boolean> => {
  for (let turns = 0; turns < f.cap; turns++) {
    await f.fix()
    // Not `changes()`: a wording gate after the fix would be the last step.
    if (read(f.findings) === undefined) return true
  }
  await f.escalate()
  return false
}
