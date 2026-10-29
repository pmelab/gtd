import { sectionFences } from "./driver-doc.js"

/**
 * The files a docs/testing.md section shows, by the name each fence's first
 * line gives (`// workflow.ts`, `# calculator.feature`), verbatim. A fence
 * without one (the section's command) is no file. Throws if the section names
 * no file — the claim under test is that these files, as printed, pass.
 */
export function extractFiles(doc: string, heading: string): ReadonlyMap<string, string> {
  const files = new Map<string, string>()
  for (const { body } of sectionFences(doc, heading)) {
    const name = /^(?:\/\/|#) (\S+\.\w+)$/.exec(body.split("\n")[0]!)?.[1]
    if (name !== undefined) files.set(name, `${body}\n`)
  }
  if (files.size === 0) throw new Error(`the "${heading}" section names no file`)
  return files
}
