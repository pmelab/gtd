// New requirements go above what the steering file already holds, untouched:
// a deferred review note the start diff alters reads as the human's edit.
export function withRequirements(existing: string, requirements: string): string {
  if (!existing.trim()) return `${requirements.trim()}\n`
  return `${requirements.trim()}\n\n${existing}${existing.endsWith("\n") ? "" : "\n"}`
}
