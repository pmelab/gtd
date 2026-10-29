interface Fence {
  readonly info: string
  readonly body: string
}

/**
 * Every fenced block of a markdown section, verbatim. Throws if the heading is
 * gone (renamed or removed). Fences follow CommonMark: ``` or ~~~, closed only
 * by a run of the same character at least as long, so a heading or a shorter
 * fence inside one (a heredoc'd markdown file) is part of the block.
 */
// fallow-ignore-next-line complexity
export function sectionFences(doc: string, heading: string): readonly Fence[] {
  const depth = heading.indexOf(" ")
  const lines = doc.split("\n")
  const start = lines.indexOf(heading)
  if (start === -1) {
    throw new Error(`the doc is missing the "${heading}" heading`)
  }
  const fences: Fence[] = []
  let open: { marker: string; info: string; body: string[] } | undefined
  for (const line of lines.slice(start + 1)) {
    if (open) {
      const close = /^(`{3,}|~{3,})\s*$/.exec(line)?.[1] ?? ""
      if (close[0] === open.marker[0] && close.length >= open.marker.length) {
        fences.push({ info: open.info, body: open.body.join("\n") })
        open = undefined
      } else open.body.push(line)
      continue
    }
    const fence = /^(`{3,}|~{3,})\s*(\S*)/.exec(line)
    if (fence) open = { marker: fence[1]!, info: fence[2]!, body: [] }
    else if (/^#+ /.test(line) && line.indexOf(" ") <= depth) break
  }
  return fences
}

/**
 * Pulls the one ```bash fenced block out of a markdown section, verbatim — the
 * doc-tested proof that this exact paste is what a feature runs. Throws if the
 * section doesn't carry exactly one bash fence (more than one would mean the
 * paste isn't self-contained, which is exactly the claim under test).
 */
export function extractBashBlock(doc: string, heading: string): string {
  const fences = sectionFences(doc, heading).filter((fence) => fence.info === "bash")
  if (fences.length !== 1) {
    throw new Error(
      `expected exactly one \`\`\`bash fenced block in the "${heading}" section, found ${fences.length}`,
    )
  }
  return fences[0]!.body
}
