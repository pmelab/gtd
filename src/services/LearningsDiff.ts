const findLearningsRange = (
  content: string,
): { start: number; end: number } | null => {
  const lines = content.split("\n")
  const headerIdx = lines.findIndex((l) => /^##\s+Learnings\s*$/.test(l))
  if (headerIdx === -1) return null

  const start = headerIdx + 1

  let end = lines.length
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) {
      end = i
      break
    }
  }

  return { start, end }
}

export const isOnlyLearningsModified = (diff: string, fileContent: string): boolean => {
  if (diff.trim() === "") return false

  const range = findLearningsRange(fileContent)
  if (!range) return false

  const lines = diff.split("\n")
  let currentOldLine = -1
  let hasHunks = false

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)/)
    if (hunkMatch) {
      currentOldLine = parseInt(hunkMatch[1]!, 10)
      hasHunks = true
      continue
    }

    if (currentOldLine === -1) continue

    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue
    }

    if (line.startsWith("-") || line.startsWith(" ")) {
      if (line.startsWith("-")) {
        if (currentOldLine < range.start || currentOldLine > range.end) return false
      }
      currentOldLine++
    } else if (line.startsWith("+")) {
      if (currentOldLine < range.start || currentOldLine > range.end) return false
    }
  }

  return hasHunks
}
