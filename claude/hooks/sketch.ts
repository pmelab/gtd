// New requirements go above what the steering file already holds: a deferred
// review note the start diff deletes reads as the human dropping it.
export function withRequirements(existing: string, requirements: string): string {
  const rest = existing.trim()
  return rest ? `${requirements}\n\n${rest}\n` : `${requirements}\n`
}
