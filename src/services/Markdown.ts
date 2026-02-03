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

export interface LintError {
  readonly line: number
  readonly rule: string
  readonly message: string
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

const knownSections = ["Action Items", "Open Questions", "Learnings"] as const

export const lint = (content: string): ReadonlyArray<LintError> => {
  const errors: Array<LintError> = []
  const lines = content.split("\n")

  // no-blockquotes
  lines.forEach((line, idx) => {
    if (/^\s*>/.test(line)) {
      errors.push({
        line: idx + 1,
        rule: "no-blockquotes",
        message: "Blockquote comments should be incorporated and removed",
      })
    }
  })

  // sections-present
  const hasActionItems = lines.some((l) => /^##\s+Action Items\s*$/.test(l))
  if (!hasActionItems) {
    errors.push({
      line: 1,
      rule: "sections-present",
      message: 'Required section "## Action Items" is missing',
    })
  }

  // sections-order
  const sectionPositions: Array<{ name: string; line: number }> = []
  lines.forEach((line, idx) => {
    const match = line.match(/^##\s+(.+?)\s*$/)
    if (match) {
      const name = match[1]!
      if (knownSections.includes(name as (typeof knownSections)[number])) {
        sectionPositions.push({ name, line: idx + 1 })
      }
    }
  })

  for (let i = 1; i < sectionPositions.length; i++) {
    const prev = knownSections.indexOf(
      sectionPositions[i - 1]!.name as (typeof knownSections)[number],
    )
    const curr = knownSections.indexOf(sectionPositions[i]!.name as (typeof knownSections)[number])
    if (curr <= prev) {
      errors.push({
        line: sectionPositions[i]!.line,
        rule: "sections-order",
        message: `Section "${sectionPositions[i]!.name}" must come after "${sectionPositions[i - 1]!.name}"`,
      })
    }
  }

  // action-item-format + action-item-tests + no-todo-comments
  const items = parseActionItems(content)
  for (const item of items) {
    const subBullets = item.body.split("\n").filter((l) => l.match(/^\s+-/))

    if (subBullets.length === 0) {
      errors.push({
        line: item.line,
        rule: "action-item-format",
        message: `Action item "${item.title}" must have at least one sub-bullet`,
      })
    }

    if (!item.checked) {
      const hasTests = item.body.split("\n").some((l) => /^\s+-\s+Tests:/.test(l))
      if (!hasTests) {
        errors.push({
          line: item.line,
          rule: "action-item-tests",
          message: `Unchecked item "${item.title}" must have a "Tests:" sub-bullet`,
        })
      }
    }

    if (item.checked) {
      item.body.split("\n").forEach((l, idx) => {
        if (/<!--\s*TODO:/.test(l)) {
          errors.push({
            line: item.line + idx + 1,
            rule: "no-todo-comments",
            message: "Checked items should not have TODO comments",
          })
        }
      })
    }
  }

  return errors
}
