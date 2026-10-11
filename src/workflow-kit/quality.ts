import { read } from "../flows/index.js"

/** Split a comma-separated lens list: trimmed, blanks dropped. */
export const lensesOf = (value: string): readonly string[] =>
  value
    .split(",")
    .map((lens) => lens.trim())
    .filter((lens) => lens.length > 0)

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
