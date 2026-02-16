import { Effect } from "effect"
import { access, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { EXAMPLE_CONFIG } from "../services/ConfigResolver.js"

export interface InitOptions {
  readonly cwd: string
  readonly global: boolean
  readonly log: (msg: string) => void
  readonly xdgConfigHome?: string
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export const initAction = (options: InitOptions): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const targetDir = options.global ? resolveGlobalDir(options) : options.cwd

    if (options.global) {
      yield* Effect.tryPromise({
        try: () => mkdir(targetDir, { recursive: true }),
        catch: () => new Error("Failed to create directory"),
      }).pipe(Effect.catchAll(() => Effect.void))
    }

    const filepath = join(targetDir, ".gtdrc.json")

    const exists = yield* Effect.tryPromise({
      try: () => fileExists(filepath),
      catch: () => false as never,
    }).pipe(Effect.catchAll(() => Effect.succeed(false)))

    if (exists) {
      options.log(`Config already exists at ${filepath}`)
      return
    }

    const content = JSON.stringify(EXAMPLE_CONFIG, null, 2) + "\n"

    const writeResult = yield* Effect.tryPromise({
      try: () => writeFile(filepath, content, "utf-8"),
      catch: (e) => e,
    }).pipe(
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    )

    if (writeResult) {
      options.log(`Created example config at ${filepath}`)
    } else {
      options.log(`Error: Failed to create config at ${filepath}`)
      yield* Effect.sync(() => process.exitCode = 1)
    }
  })

const resolveGlobalDir = (options: InitOptions): string => {
  const xdgConfigHome =
    options.xdgConfigHome ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
  return join(xdgConfigHome, "gtd")
}
