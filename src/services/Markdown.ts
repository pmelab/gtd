import { Option } from "effect"

export interface ActionItem {
  readonly title: string
  readonly body: string
  readonly line: number
  readonly checked: boolean
}

export interface Package {
  readonly title: string
  readonly line: number
  readonly items: ReadonlyArray<ActionItem>
}

export const detectState = (content: string): "empty" | "no-action-items" | "has-action-items" => {
  if (content.trim() === "") return "empty"
  if (/- \[[ x]\]/.test(content)) return "has-action-items"
  return "no-action-items"
}

const parseActionItemsFromLines = (
  lines: ReadonlyArray<string>,
  lineOffset: number,
): ReadonlyArray<ActionItem> => {
  const items: Array<ActionItem> = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    const match = line.match(/^- \[([ x])\] (.+)$/)
    if (match) {
      const checked = match[1] === "x"
      const title = match[2]!
      const bodyLines: Array<string> = []
      const itemLine = lineOffset + i + 1
      i++
      while (i < lines.length && lines[i]!.startsWith("  ")) {
        bodyLines.push(lines[i]!)
        i++
      }
      items.push({ title, body: bodyLines.join("\n"), line: itemLine, checked })
    } else {
      i++
    }
  }

  return items
}

const parseActionItems = (content: string): ReadonlyArray<ActionItem> =>
  parseActionItemsFromLines(content.split("\n"), 0)

export const hasUncheckedItems = (content: string): boolean =>
  parseActionItems(content).some((item) => !item.checked)

const findActionItemsSection = (lines: ReadonlyArray<string>): { start: number; end: number } | null => {
  const sectionIdx = lines.findIndex((l) => /^##\s+Action Items\s*$/.test(l))
  if (sectionIdx === -1) return null

  let endIdx = lines.length
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) {
      endIdx = i
      break
    }
  }
  return { start: sectionIdx, end: endIdx }
}

export const parsePackages = (content: string): ReadonlyArray<Package> => {
  const lines = content.split("\n")
  const section = findActionItemsSection(lines)
  if (!section) return []

  const sectionLines = lines.slice(section.start + 1, section.end)
  const sectionOffset = section.start + 1

  // Find ### headings within the section
  const headings: Array<{ title: string; index: number }> = []
  sectionLines.forEach((line, idx) => {
    const match = line.match(/^###\s+(.+?)\s*$/)
    if (match) headings.push({ title: match[1]!, index: idx })
  })

  if (headings.length === 0) return []

  const packages: Array<Package> = []

  // Each ### heading defines a package
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!
    const startIdx = heading.index + 1
    const endIdx = i + 1 < headings.length ? headings[i + 1]!.index : sectionLines.length
    const pkgLines = sectionLines.slice(startIdx, endIdx)
    const items = parseActionItemsFromLines(pkgLines, sectionOffset + startIdx)
    packages.push({ title: heading.title, line: sectionOffset + heading.index + 1, items })
  }

  return packages
}

export const checkOffPackage = (content: string, pkg: Package): string => {
  const lines = content.split("\n")
  for (const item of pkg.items) {
    if (!item.checked) {
      // item.line is 1-based
      const idx = item.line - 1
      lines[idx] = lines[idx]!.replace("- [ ]", "- [x]")
    }
  }
  return lines.join("\n")
}

export const getNextUncheckedPackage = (content: string): Option.Option<Package> => {
  const packages = parsePackages(content)
  const pkg = packages.find((p) => p.items.some((item) => !item.checked))
  return pkg ? Option.some(pkg) : Option.none()
}

export const extractLearnings = (content: string): string => {
  const lines = content.split("\n")
  const sectionIdx = lines.findIndex((l) => /^##\s+Learnings\s*$/.test(l))
  if (sectionIdx === -1) return ""

  const bodyLines: Array<string> = []
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) break
    bodyLines.push(lines[i]!)
  }
  return bodyLines.join("\n").trim()
}

export const hasLearningsSection = (content: string): boolean =>
  /^##\s+Learnings\s*$/m.test(content)
