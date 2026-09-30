// Zero imports on purpose: a leaf both `Edge.ts` and this module's siblings
// can import, so `"unspecified"` exists exactly once in the codebase.

/** The bucket a cost with no `--model` tag is grouped under, kept distinct so a mixed history still totals correctly. */
export const UNATTRIBUTED_MODEL = "unspecified"

/** The plain-text twin of `OutcomeScript.ts`'s `printfLine`. Lives here so `src/wire/`'s encoders reach it without importing out of the leaf. */
export const renderFormat = (fmt: string, ...args: readonly string[]): string => {
  let i = 0
  return fmt.replace(/%s/g, () => args[i++] ?? "")
}
