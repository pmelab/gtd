export type Pasted = { arg: string } | { lost: string }

const PLACEHOLDER = /\[Pasted text #\d+[^\]]*\]/

// The mod cannot recover an unexpanded paste: Claude Code's paste cache is keyed
// by a hash it does not expose.
export function pastedCommand(text: string): Pasted | undefined {
  const m = /^\/gtd\s+([\s\S]*)$/.exec(text)
  const arg = m?.[1]?.trim()
  if (!arg) return undefined
  if (PLACEHOLDER.test(arg)) {
    return {
      lost: "The pasted requirements did not arrive whole. Write them to .gtd/TODO.md and run /gtd.",
    }
  }
  return { arg }
}
