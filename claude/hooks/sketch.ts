// New requirements go above what the steering file already holds, untouched:
// anything already there that the start diff alters reads as the human's edit.
export function withRequirements(existing: string, requirements: string): string {
  const head = `${requirements.trimEnd()}\n`
  return existing.trim() ? `${head}\n${existing}` : head
}
