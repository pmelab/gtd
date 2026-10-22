// A heading inside a fence (a heredoc'd markdown file) does not end the section:
// blank out fenced `#`s, keeping offsets, before looking for the next heading.
const sectionOf = (rest: string): string => {
  const masked = rest.replace(/```[\s\S]*?```/g, (fence) => fence.replaceAll("#", " "))
  const end = masked.search(/\n#{2,3} /)
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * Pulls the one ```bash fenced block out of a markdown section, verbatim — the
 * doc-tested proof that this exact paste is what a feature runs. Throws if the
 * heading is gone (renamed or removed) or the section doesn't carry exactly one
 * bash fence (more than one would mean the paste isn't self-contained, which is
 * exactly the claim under test).
 */
// fallow-ignore-next-line complexity
export function extractBashBlock(doc: string, heading: string): string {
  const headingIndex = doc.indexOf(`\n${heading}\n`)
  if (headingIndex === -1) {
    throw new Error(`the doc is missing the "${heading}" heading`)
  }
  const sectionStart = headingIndex + `\n${heading}\n`.length
  const rest = doc.slice(sectionStart)
  const section = sectionOf(rest)

  const fences = [...section.matchAll(/```bash\n([\s\S]*?)\n```/g)]
  if (fences.length === 0) {
    throw new Error(`no \`\`\`bash fenced block found in the "${heading}" section`)
  }
  if (fences.length > 1) {
    throw new Error(
      `expected exactly one \`\`\`bash fenced block in the "${heading}" section, found ${fences.length}`,
    )
  }
  return fences[0]![1]!
}
