import { Effect } from "effect"
import { readFile, writeFile } from "node:fs/promises"

const TODO_COMMENT_PATTERN = /^\s*\/\/\s*(TODO|FIXME|HACK|XXX):/i

export interface NewlyAddedTodo {
  readonly file: string
  readonly lineContent: string
}

export const findNewlyAddedTodos = (diff: string, todoFile: string): NewlyAddedTodo[] => {
  const results: NewlyAddedTodo[] = []
  const lines = diff.split("\n")
  let currentFile: string | null = null

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/diff --git a\/(.+?) b\//)
      currentFile = match?.[1] ?? null
      continue
    }

    if (!currentFile || currentFile === todoFile) continue

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const content = line.slice(1)
      if (TODO_COMMENT_PATTERN.test(content)) {
        results.push({ file: currentFile, lineContent: content })
      }
    }
  }

  return results
}

export const removeTodoLines = (
  todos: ReadonlyArray<NewlyAddedTodo>,
  cwd: string,
): Effect.Effect<number, Error> =>
  Effect.gen(function* () {
    const byFile = new Map<string, string[]>()
    for (const todo of todos) {
      const existing = byFile.get(todo.file) ?? []
      existing.push(todo.lineContent)
      byFile.set(todo.file, existing)
    }

    let removedCount = 0

    for (const [file, linesToRemove] of byFile) {
      const filePath = `${cwd}/${file}`
      const content = yield* Effect.tryPromise({
        try: () => readFile(filePath, "utf-8"),
        catch: (e) => new Error(`Failed to read ${filePath}: ${e}`),
      })

      const fileLines = content.split("\n")
      const filteredLines: string[] = []

      for (const fileLine of fileLines) {
        const shouldRemove = linesToRemove.some((todoLine) => fileLine.trimEnd() === todoLine.trimEnd())
        if (shouldRemove) {
          removedCount++
          const idx = linesToRemove.indexOf(
            linesToRemove.find((t) => fileLine.trimEnd() === t.trimEnd())!,
          )
          if (idx >= 0) linesToRemove.splice(idx, 1)
        } else {
          filteredLines.push(fileLine)
        }
      }

      const newContent = filteredLines.join("\n")
      if (newContent !== content) {
        yield* Effect.tryPromise({
          try: () => writeFile(filePath, newContent, "utf-8"),
          catch: (e) => new Error(`Failed to write ${filePath}: ${e}`),
        })
      }
    }

    return removedCount
  })
