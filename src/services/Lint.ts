import type { ActionItem } from "./Markdown.js"

export interface LintError {
  readonly line: number
  readonly rule: string
  readonly message: string
}

const knownSections = ["Action Items", "Open Questions", "Learnings"] as const

const parseActionItems = (content: string): ReadonlyArray<ActionItem> => {
  const lines = content.split("\n")
  const items: Array<ActionItem> = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    const match = line.match(/^- \[([ x])\] (.+)$/)
    if (match) {
      const checked = match[1] === "x"
      const title = match[2]!
      const bodyLines: Array<string> = []
      const itemLine = i + 1
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
