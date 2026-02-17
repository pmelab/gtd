const FEEDBACK_MARKERS = /\b(TODO|FIX|FIXME|HACK|XXX):/i

const BLOCKQUOTE_ADDITION = /^\+\s*> /

interface ParsedFile {
  path: string
  headers: string[]
  hunks: Array<{ header: string; lines: string[] }>
  isNew: boolean
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
      current = { path: match?.[1] ?? "", headers: [line], hunks: [], isNew: false }
      currentHunk = null
      continue
    }

    if (!current) continue

    if (line.startsWith("index ") || line.startsWith("new file mode ")) {
      if (!currentHunk) current.headers.push(line)
      continue
    }

    if (line.startsWith("--- ")) {
      if (!currentHunk) {
        current.headers.push(line)
        if (line === "--- /dev/null") {
          current.isNew = true
        }
      }
      continue
    }

    if (line.startsWith("+++ ")) {
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
  return hunk.lines.some((line) => line.startsWith("+"))
}

const isBlockquoteHunk = (hunk: { lines: string[] }): boolean => {
  const addedLines = hunk.lines.filter((line) => line.startsWith("+"))
  return addedLines.length > 0 && addedLines.every((line) => BLOCKQUOTE_ADDITION.test(line))
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

export interface ClassifiedDiff {
  fixes: string
  seed: string
  feedback: string
  humanTodos: string
}

export const classifyDiff = (diff: string, todoFile: string): ClassifiedDiff => {
  if (diff.trim() === "") return { fixes: "", seed: "", feedback: "", humanTodos: "" }

  const files = parseUnifiedDiff(diff)
  const fixFiles: ParsedFile[] = []
  const seedFiles: ParsedFile[] = []
  const feedbackFiles: ParsedFile[] = []
  const humanTodoFiles: ParsedFile[] = []

  for (const file of files) {
    if (file.path === todoFile) {
      if (file.isNew) {
        const seedHunks = file.hunks.filter(isTodoFeedbackHunk)
        if (seedHunks.length > 0) {
          seedFiles.push({ ...file, hunks: seedHunks })
        }
      } else {
        const blockquoteHunks: ParsedFile["hunks"] = []
        const otherFeedbackHunks: ParsedFile["hunks"] = []

        for (const hunk of file.hunks) {
          if (isBlockquoteHunk(hunk)) {
            blockquoteHunks.push(hunk)
          } else if (isTodoFeedbackHunk(hunk)) {
            otherFeedbackHunks.push(hunk)
          }
        }

        const allFeedbackHunks = [...blockquoteHunks, ...otherFeedbackHunks]
        if (allFeedbackHunks.length > 0) {
          feedbackFiles.push({ ...file, hunks: allFeedbackHunks })
        }
      }
    } else {
      const fixHunks: ParsedFile["hunks"] = []
      const humanTodoHunks: ParsedFile["hunks"] = []

      for (const hunk of file.hunks) {
        if (isFeedbackHunk(hunk)) {
          humanTodoHunks.push(hunk)
        } else {
          fixHunks.push(hunk)
        }
      }

      if (fixHunks.length > 0) {
        fixFiles.push({ ...file, hunks: fixHunks })
      }
      if (humanTodoHunks.length > 0) {
        humanTodoFiles.push({ ...file, hunks: humanTodoHunks })
      }
    }
  }

  return {
    fixes: reconstructDiff(fixFiles),
    seed: reconstructDiff(seedFiles),
    feedback: reconstructDiff(feedbackFiles),
    humanTodos: reconstructDiff(humanTodoFiles),
  }
}
