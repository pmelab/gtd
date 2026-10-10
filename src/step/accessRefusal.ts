import { globMatches } from "../replay/index.js"
import type { PendingChange } from "../workflow/index.js"
import { ACCESS_REFUSAL } from "../wire/index.js"

/**
 * The landing refusal for changes outside `write`, or `undefined` when every
 * path is allowed. `null` is unrestricted. The message is the fix prompt: gtd
 * runs no fix turn of its own.
 */
export const accessRefusal = (
  changes: readonly PendingChange[],
  write: readonly string[] | null,
): string | undefined => {
  if (write === null) return undefined
  const offending = [
    ...new Set(
      changes.filter((c) => !write.some((glob) => globMatches(c.path, glob))).map((c) => c.path),
    ),
  ]
  if (offending.length === 0) return undefined
  return [
    ACCESS_REFUSAL,
    ...offending.map((path) => `  - ${path}`),
    `allowed: ${write.length === 0 ? "(nothing)" : write.join(", ")}`,
  ].join("\n")
}
