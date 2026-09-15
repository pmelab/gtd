// Zero imports on purpose — `Edge.ts` and this module's own siblings both
// import `UNATTRIBUTED_MODEL` as a value from here, so the literal
// `"unspecified"` exists exactly once in the whole codebase.

/** The bucket a cost with no `--model` tag is grouped under, kept distinct so a mixed history still totals correctly. */
export const UNATTRIBUTED_MODEL = "unspecified"

/** The plain-text twin of `printfLine` (`OutcomeScript.ts`): substitutes `args` into `fmt`'s `%s` placeholders, in order. Lives here (not `OutcomeScript.ts`) so `src/wire/`'s plain-text encoders (`noopText`/`landProseText`) can reach it without a real import out of the leaf. */
export const renderFormat = (fmt: string, ...args: readonly string[]): string => {
  let i = 0
  return fmt.replace(/%s/g, () => args[i++] ?? "")
}
