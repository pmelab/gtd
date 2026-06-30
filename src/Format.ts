import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { extname } from "node:path"
import prettier from "prettier"

const PRETTIER_CONFIG: prettier.Options = {
  parser: "markdown",
  printWidth: 80,
  proseWrap: "always",
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])

export const formatString = (content: string): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: () => prettier.format(content, PRETTIER_CONFIG),
    catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
  })

export const formatFile = (path: string): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const ext = extname(path).toLowerCase()
    if (!MARKDOWN_EXTENSIONS.has(ext)) {
      return yield* Effect.fail(
        new Error(`gtd format: ${path} is not a markdown file (expected .md or .markdown)`),
      )
    }

    const fs = yield* FileSystem.FileSystem

    const exists = yield* fs.exists(path)
    if (!exists) {
      return yield* Effect.fail(new Error(`gtd: skipped formatting ${path}: not found`))
    }

    const content = yield* fs.readFileString(path, "utf8")
    const formatted = yield* formatString(content)

    if (formatted !== content) {
      yield* fs.writeFileString(path, formatted)
    }
  }).pipe(Effect.mapError((e: unknown) => (e instanceof Error ? e : new Error(String(e)))))
