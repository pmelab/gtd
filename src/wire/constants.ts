// Zero imports on purpose: a leaf both `Edge.ts` and this module's siblings
// can import, so `"unspecified"` exists exactly once in the codebase.

/**
 * The top-level `schema` of every JSON document a driver reads. Bumped only
 * when a field is removed or renamed — never for an added one — and never tied
 * to the package version, since a driver can be installed apart from gtd.
 */
export const WIRE_SCHEMA = 1

/** The bucket a cost with no `--model` tag is grouped under, kept distinct so a mixed history still totals correctly. */
export const UNATTRIBUTED_MODEL = "unspecified"

/** The plain-text twin of `OutcomeScript.ts`'s `printfLine`. Lives here so `src/wire/`'s encoders reach it without importing out of the leaf. */
export const renderFormat = (fmt: string, ...args: readonly string[]): string => {
  let i = 0
  return fmt.replace(/%s/g, () => args[i++] ?? "")
}

/** The first line of the landing refusal for a turn that wrote outside its `write` access — a stable marker drivers and tests grep for. */
export const ACCESS_REFUSAL =
  "gtd land: this turn wrote outside its write access — revert these paths, then run `gtd land` again:"
