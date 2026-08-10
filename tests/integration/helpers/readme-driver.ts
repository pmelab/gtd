const SECTION_HEADING = "### A complete minimal driver"
const NEXT_HEADING = /\n#{2,3} /

/**
 * Pulls the ```bash fenced block out of README.md's "A complete minimal
 * driver" section, verbatim — the doc-tested proof that this exact paste is
 * what `readme-driver.feature` runs. Throws if the heading is gone (renamed
 * or removed) or the section doesn't carry exactly one bash fence (more than
 * one would mean the paste isn't self-contained, which is exactly the claim
 * under test).
 */
// fallow-ignore-next-line complexity
export function extractMinimalDriver(readme: string): string {
  const headingIndex = readme.indexOf(`\n${SECTION_HEADING}\n`)
  if (headingIndex === -1) {
    throw new Error(`README.md is missing the "${SECTION_HEADING}" heading`)
  }
  const sectionStart = headingIndex + `\n${SECTION_HEADING}\n`.length
  const rest = readme.slice(sectionStart)
  const nextHeading = rest.match(NEXT_HEADING)
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest

  const fences = [...section.matchAll(/```bash\n([\s\S]*?)\n```/g)]
  if (fences.length === 0) {
    throw new Error(`no \`\`\`bash fenced block found in the "${SECTION_HEADING}" section`)
  }
  if (fences.length > 1) {
    throw new Error(
      `expected exactly one \`\`\`bash fenced block in the "${SECTION_HEADING}" section, found ${fences.length}`,
    )
  }
  return fences[0]![1]!
}
