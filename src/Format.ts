import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import prettier from "prettier"

const PRETTIER_CONFIG: prettier.Options = {
  parser: "markdown",
  printWidth: 80,
  proseWrap: "always",
}

export const formatFile = (path: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const exists = yield* fs.exists(path)
    if (!exists) {
      process.stderr.write(`gtd: skipped formatting ${path}: not found\n`)
      return
    }

    const content = yield* fs.readFileString(path, "utf8")
    const formatted = yield* Effect.tryPromise({
      try: () => prettier.format(content, PRETTIER_CONFIG),
      catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
    })

    if (formatted !== content) {
      yield* fs.writeFileString(path, formatted)
    }
  }).pipe(
    Effect.catchAll((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`gtd: skipped formatting ${path}: ${message}\n`)
      return Effect.void
    }),
  )
