import type { SteeringEdit } from "./SteeringFormat.js"

/** Splices `edits` into `content`, sorted last-to-first so an earlier range's offset is never invalidated by a later edit. Positions are 0-based line/character over `\n`-split lines. */
export const applySteeringEdits = (content: string, edits: readonly SteeringEdit[]): string => {
  const lines = content.split("\n")
  const toOffset = (pos: { readonly line: number; readonly character: number }): number => {
    let offset = 0
    for (let i = 0; i < pos.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
    return offset + pos.character
  }
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
  let result = content
  for (const edit of sorted) {
    result =
      result.slice(0, toOffset(edit.range.start)) +
      edit.newText +
      result.slice(toOffset(edit.range.end))
  }
  return result
}
