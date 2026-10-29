const HELP_WIDTH = 80

/**
 * Word-wraps prose to `width` columns, every line prefixed by `indent`.
 * Paragraphs are separated by a blank line; a paragraph whose lines start
 * with two spaces is an example and is kept verbatim (indented, not wrapped).
 */
const wrapParagraph = (paragraph: string, width: number, indent: string): string[] => {
  const lines: string[] = []
  let line = ""
  // A `code span` is one word: a command split across lines can't be copied.
  for (const word of paragraph.match(/\S*`[^`]*`\S*|\S+/g) ?? []) {
    if (line !== "" && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line)
      line = word
    } else {
      line = line === "" ? word : `${line} ${word}`
    }
  }
  if (line !== "") lines.push(indent + line)
  return lines
}

export const wrap = (text: string, width = HELP_WIDTH, indent = ""): string[] =>
  text
    .split("\n\n")
    .flatMap((paragraph, i) => [
      ...(i > 0 ? [""] : []),
      ...(paragraph.startsWith("  ")
        ? paragraph.split("\n").map((l) => indent + l)
        : wrapParagraph(paragraph, width, indent)),
    ])

/** `term` and `description` side by side, the description wrapped into the column after `column`; a term too wide for it gets a line of its own. */
export const definition = (term: string, description: string, column: number): string[] => {
  const cell = `  ${term}`
  const body = wrap(description, HELP_WIDTH, " ".repeat(column))
  if (cell.length + 1 >= column) return [cell, ...body]
  const [first = "", ...rest] = body
  return [cell.padEnd(column) + first.trimStart(), ...rest]
}

/** Optimal-string-alignment distance: Levenshtein plus adjacent transpositions, so `nxet` is one edit from `next`. */
const distance = (a: string, b: string): number => {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1)
      }
      d[i]![j] = best
    }
  }
  return d[a.length]![b.length]!
}

/** The candidate closest to `word`, when it is a plausible typo of it: at most one edit per three characters, and at least one. */
export const closest = (word: string, candidates: readonly string[]): string | undefined => {
  const limit = Math.max(1, Math.floor(word.length / 3))
  let best: { readonly name: string; readonly d: number } | undefined
  for (const name of candidates) {
    const d = distance(word, name)
    if (d <= limit && (best === undefined || d < best.d)) best = { name, d }
  }
  return best?.name
}
