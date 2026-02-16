const FEEDBACK_MARKERS = /\b(TODO|FIX|FIXME|HACK|XXX):/i

interface ParsedFile {
  path: string
  headers: string[]
  hunks: Array<{ header: string; lines: string[] }>
}

const parseUnifiedDiff = (diff: string): ParsedFile[] => {
  if (diff.trim() === "") return []

  const files: ParsedFile[] = []
  const lines = diff.split("\n")
  let current: ParsedFile | null = null
  let currentHunk: { header: string; lines: string[] } | null = null

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (currentHunk && current) current.hunks.push(currentHunk)
      if (current) files.push(current)

      const match = line.match(/diff --git a\/(.+?) b\//)
      current = { path: match?.[1] ?? "", headers: [line], hunks: [] }
      currentHunk = null
      continue
    }

    if (!current) continue

    if (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      if (!currentHunk) current.headers.push(line)
      continue
    }

    if (line.startsWith("@@ ")) {
      if (currentHunk) current.hunks.push(currentHunk)
      currentHunk = { header: line, lines: [] }
      continue
    }

    if (currentHunk) {
      currentHunk.lines.push(line)
    }
  }

  if (currentHunk && current) current.hunks.push(currentHunk)
  if (current) files.push(current)

  return files
}

const isFeedbackHunk = (hunk: { lines: string[] }): boolean => {
  return hunk.lines.some((line) => line.startsWith("+") && FEEDBACK_MARKERS.test(line))
}

const isTodoFeedbackHunk = (hunk: { lines: string[] }): boolean => {
  return hunk.lines.some((line) => /^\+\s*>/.test(line))
}

const reconstructDiff = (files: ParsedFile[]): string => {
  if (files.length === 0) return ""

  const parts: string[] = []
  for (const file of files) {
    if (file.hunks.length === 0) continue
    parts.push(file.headers.join("\n"))
    for (const hunk of file.hunks) {
      parts.push(hunk.header)
      parts.push(hunk.lines.join("\n"))
    }
  }

  return parts.length > 0 ? parts.join("\n") + "\n" : ""
}

export const classifyDiff = (diff: string): { fixes: string; feedback: string } => {
  if (diff.trim() === "") return { fixes: "", feedback: "" }

  const files = parseUnifiedDiff(diff)
  const fixFiles: ParsedFile[] = []
  const feedbackFiles: ParsedFile[] = []

  for (const file of files) {
    const fixHunks: ParsedFile["hunks"] = []
    const feedbackHunks: ParsedFile["hunks"] = []

    const classify = file.path === "TODO.md" ? isTodoFeedbackHunk : isFeedbackHunk

    for (const hunk of file.hunks) {
      if (classify(hunk)) {
        feedbackHunks.push(hunk)
      } else {
        fixHunks.push(hunk)
      }
    }

    if (fixHunks.length > 0) {
      fixFiles.push({ ...file, hunks: fixHunks })
    }
    if (feedbackHunks.length > 0) {
      feedbackFiles.push({ ...file, hunks: feedbackHunks })
    }
  }

  return {
    fixes: reconstructDiff(fixFiles),
    feedback: reconstructDiff(feedbackFiles),
  }
}
