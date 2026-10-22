/**
 * Pulls the one ```bash fenced block out of a markdown section, verbatim — the
 * doc-tested proof that this exact paste is what a feature runs. Throws if the
 * heading is gone (renamed or removed) or the section doesn't carry exactly one
 * bash fence (more than one would mean the paste isn't self-contained, which is
 * exactly the claim under test). Fences follow CommonMark: ``` or ~~~, closed
 * only by a run of the same character at least as long, so a heading or a
 * shorter fence inside one (a heredoc'd markdown file) is part of the paste.
 */
// fallow-ignore-next-line complexity
export function extractBashBlock(doc: string, heading: string): string {
  const depth = heading.indexOf(" ")
  const lines = doc.split("\n")
  const start = lines.indexOf(heading)
  if (start === -1) {
    throw new Error(`the doc is missing the "${heading}" heading`)
  }
  const fences: string[] = []
  let open: { marker: string; bash: boolean; body: string[] } | undefined
  for (const line of lines.slice(start + 1)) {
    if (open) {
      const close = /^(`{3,}|~{3,})\s*$/.exec(line)?.[1] ?? ""
      if (close[0] === open.marker[0] && close.length >= open.marker.length) {
        if (open.bash) fences.push(open.body.join("\n"))
        open = undefined
      } else open.body.push(line)
      continue
    }
    const fence = /^(`{3,}|~{3,})\s*(\S*)/.exec(line)
    if (fence) open = { marker: fence[1]!, bash: fence[2] === "bash", body: [] }
    else if (/^#+ /.test(line) && line.indexOf(" ") <= depth) break
  }
  if (fences.length !== 1) {
    throw new Error(
      `expected exactly one \`\`\`bash fenced block in the "${heading}" section, found ${fences.length}`,
    )
  }
  return fences[0]!
}
